/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, GenerateContentResponse, Modality } from "@google/genai";
import { SiteDatapoints } from "../types";

// Helper function to convert a File object to a Gemini API Part
const fileToPart = async (file: File): Promise<{ inlineData: { mimeType: string; data: string; } }> => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = error => reject(error);
    });
    
    const arr = dataUrl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");
    
    const mimeType = mimeMatch[1];
    const data = arr[1];
    return { inlineData: { mimeType, data } };
};

const handleImageApiResponse = (
    response: GenerateContentResponse,
    context: string // e.g., "edit", "filter", "adjustment"
): string => {
    // 1. Check for prompt blocking first
    if (response.promptFeedback?.blockReason) {
        const { blockReason, blockReasonMessage } = response.promptFeedback;
        const errorMessage = `Request was blocked. Reason: ${blockReason}. ${blockReasonMessage || ''}`;
        console.error(errorMessage, { response });
        throw new Error(errorMessage);
    }

    // 2. Try to find the image part
    const imagePartFromResponse = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);

    if (imagePartFromResponse?.inlineData) {
        const { mimeType, data } = imagePartFromResponse.inlineData;
        console.log(`Received image data (${mimeType}) for ${context}`);
        return `data:${mimeType};base64,${data}`;
    }

    // 3. If no image, check for other reasons
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== 'STOP') {
        const errorMessage = `Image generation for ${context} stopped unexpectedly. Reason: ${finishReason}. This often relates to safety settings.`;
        console.error(errorMessage, { response });
        throw new Error(errorMessage);
    }
    
    const textFeedback = response.text?.trim();
    const errorMessage = `The AI model did not return an image for the ${context}. ` + 
        (textFeedback 
            ? `The model responded with text: "${textFeedback}"`
            : "This can happen due to safety filters or if the request is too complex. Please try rephrasing your prompt to be more direct.");

    console.error(`Model response did not contain an image part for ${context}.`, { response });
    throw new Error(errorMessage);
};

/**
 * Detects the site boundary from a survey image and returns an overlay image.
 * @param surveyImage The site survey image file.
 * @returns A promise that resolves to the data URL of the boundary overlay image.
 */
export const detectSiteBoundary = async (surveyImage: File): Promise<string> => {
    console.log('Detecting site boundary...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const surveyImagePart = await fileToPart(surveyImage);
    const prompt = `Analyze the provided site survey image. Your task is to identify the primary property boundary.
    
    Instructions:
    1.  Trace the exact site boundary polygon with a prominent red line (e.g., 3-5 pixels thick).
    2.  The output image must have the same dimensions as the input.
    3.  Make the background of the output image transparent, so only the red line is visible. This is crucial for overlaying.
    
    Output: Return ONLY the final image with the transparent background and red boundary line. Do not return any text.`;

    const textPart = { text: prompt };

    console.log('Sending survey image to model for boundary detection...');
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [surveyImagePart, textPart] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    console.log('Received boundary detection response from model.', response);

    return handleImageApiResponse(response, 'site boundary detection');
};

/**
 * Refines a site boundary using a survey, a user-drawn mask, and a text query.
 * @param surveyImage The original site survey image file.
 * @param maskImage The user's drawing on a transparent canvas.
 * @param query The user's text instructions.
 * @returns A promise that resolves to the data URL of the new boundary overlay image.
 */
export const refineSiteBoundary = async (
    surveyImage: File,
    maskImage: File,
    query: string
): Promise<string> => {
    console.log('Refining site boundary with user input...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const surveyPart = await fileToPart(surveyImage);
    const maskPart = await fileToPart(maskImage);

    const prompt = `You are an expert image editor specializing in site surveys. The user wants to refine a detected site boundary.
You are given three inputs:
1. The original site survey image.
2. A mask image where the user has drawn on the areas to be corrected.
3. A text query with instructions.

Your task is to generate a new, corrected site boundary overlay.

Instructions:
- Analyze the original survey.
- Focus on the areas highlighted in the mask image.
- Follow the user's text query: "${query}"
- The output must be a transparent PNG with only a single, clean, red line representing the corrected boundary.
- The output image dimensions must match the original survey image.

Output: Return ONLY the final image. Do not return any text.`;

    const textPart = { text: prompt };
    
    console.log('Sending survey, mask, and query to the model...');
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [surveyPart, maskPart, textPart] },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    console.log('Received refined boundary response from model.', response);

    return handleImageApiResponse(response, 'refine site boundary');
};


/**
 * Gets AI-recommended site plan datapoints based on a survey image.
 * @param surveyImage The site survey image file.
 * @param purpose The purpose of the project.
 * @param priority The main design priority.
 * @returns A promise that resolves to the text of the recommendations.
 */
export const getSitePlanDatapoints = async (
    surveyImage: File,
    purpose: string,
    priority: string,
): Promise<string> => {
    console.log('Getting site plan datapoint recommendations...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    const surveyImagePart = await fileToPart(surveyImage);
    
    const prompt = `You are an expert urban planner. Analyze the provided site survey image. Based on the survey and the user's goals, recommend site plan datapoints with numbers.

User Goals:
- Project Purpose: ${purpose}
- Design Priority: ${priority}

Refine your numerical recommendations to best achieve the user's priority. For example, for 'Maximize Lot Yield', suggest smaller minimum lot sizes. For 'Minimize Road Length', suggest efficient road widths.

Output format MUST be exactly as follows, with only numbers after the colon:
- Coverage Constraints:
    - Maximum buildable coverage (%): [number]
    - Minimum green coverage (%): [number]
    - Minimum open space (%): [number]
- Lot Standards:
    - Minimum lot size (sq ft): [number]
    - Minimum lot width (ft): [number]
- Setback Requirements:
    - Front (ft): [number]
    - Rear (ft): [number]
    - Side (ft): [number]
- Infrastructure Specifications:
    - Road width (ft): [number]
    - Sidewalk width (ft): [number]`;

    const textPart = { text: prompt };

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [surveyImagePart, textPart] },
    });

    console.log('Received datapoint recommendations from model.');
    return response.text;
};


/**
 * Generates a site plan image from a site survey image.
 * @param surveyImage The site survey image file.
 * @param boundaryImage The site boundary overlay image file.
 * @param accessPointsImage Optional image with user-marked access points.
 * @param purpose The purpose of the project (e.g., "Commercial").
 * @param priority The main design priority (e.g., "Maximize Lot Yield").
 * @param datapoints The detailed site parameters.
 * @param networkType The type of road network to generate.
 * @returns A promise that resolves to the data URL of the generated site plan image.
 */
export const generateSitePlan = async (
    surveyImage: File,
    boundaryImage: File,
    accessPointsImage: File | null,
    purpose: string,
    priority: string,
    datapoints: SiteDatapoints,
    networkType: string,
): Promise<string> => {
    console.log(`Starting site plan generation for ${networkType} network...`);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const surveyImagePart = await fileToPart(surveyImage);
    const boundaryImagePart = await fileToPart(boundaryImage);
    const parts = [surveyImagePart, boundaryImagePart];
    
    let accessPointsPrompt = '';
    if (accessPointsImage) {
        const accessPointsPart = await fileToPart(accessPointsImage);
        parts.push(accessPointsPart);
        accessPointsPrompt = `
**Road Access Points:** You have been provided a third image with blue circles marking mandatory road access points. The road network you design MUST connect to these points. This is a critical requirement.`;
    }

    const prompt = `You are an expert urban planner and architect. Your task is to generate a professional, clear, and detailed site plan.
You have been provided with:
1. An image of a site survey.
2. An image showing the exact property boundary line in red on a transparent background.
${accessPointsImage ? "3. An image with blue circles marking mandatory road access points.\n" : ""}
**Primary instruction: All elements of the generated site plan (roads, lots, green spaces, etc.) MUST be located entirely INSIDE the red boundary line shown in the boundary image.** Do not draw anything outside of this boundary.
${accessPointsPrompt}

User Requirements:
- Project Purpose: ${purpose}
- Design Priority: ${priority}

Road Network Style: Design a **${networkType} Network**.
- A Grid network features streets in a criss-cross pattern.
- A Radial network features roads spreading out from a central point.
- A Circular network features roads that form loops or circles.
- A Hierarchical network features a mix of major arterial roads and smaller local streets for efficient traffic flow.

Site Plan Constraints (Adhere Strictly):
- Maximum buildable coverage: ${datapoints.maxBuildableCoverage}%
- Minimum green coverage: ${datapoints.minGreenCoverage}%
- Minimum open space: ${datapoints.minOpenSpace}%
- Minimum lot size: ${datapoints.minLotSize} sq ft
- Minimum lot width: ${datapoints.minLotWidth} ft
- Setbacks: ${datapoints.frontSetback} ft (Front), ${datapoints.rearSetback} ft (Rear), ${datapoints.sideSetback} ft (Side)
- Road width: ${datapoints.roadWidth} ft
- Sidewalk width: ${datapoints.sidewalkWidth} ft

Instructions:
1.  Use the boundary image as a strict mask. The site plan must fill the area within the red line and not extend beyond it.
2.  Use the survey image for context (topography, existing features if any).
3.  Create a top-down, 2D site plan drawing that strictly follows all the Site Plan Constraints listed above.
4.  The layout must incorporate the specified **${networkType} road network style**.
5.  The layout should reflect the user's stated '${purpose}' and '${priority}'.
6.  Incorporate key features from the survey, such as property lines, building footprints, setbacks, dimensions, and easements.
7.  Add standard site plan elements like a north arrow, a graphical scale, and basic landscaping for context.
8.  The final output must be a clean, high-resolution PNG image of the site plan. Do not add any text, titles, or labels outside of the plan itself.

Output: Return ONLY the final site plan image. Do not return text.`;

    const textPart = { text: prompt };
    // FIX: Instead of pushing to `parts` which was inferred as an array of only image parts,
    // create a new array inline during the API call. This allows TypeScript to correctly
    // infer the union type for the array contents (image parts and text parts).


    console.log('Sending survey image and prompt to the model...');
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [...parts, textPart] },
        config: {
            responseModalities: [Modality.IMAGE, Modality.TEXT],
        },
    });
    console.log('Received response from model.', response);

    return handleImageApiResponse(response, 'site plan generation');
};

/**
 * Refines an existing site plan based on user input.
 * @param currentPlanImage The current site plan image file.
 * @param surveyImage The original site survey image file for context.
 * @param query The user's text instructions for refinement.
 * @param datapoints The updated detailed site parameters.
 * @returns A promise that resolves to the data URL of the refined site plan image.
 */
export const refineSitePlan = async (
    currentPlanImage: File,
    surveyImage: File,
    query: string,
    datapoints: SiteDatapoints,
): Promise<string> => {
    console.log('Refining site plan with user query and new datapoints...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const currentPlanPart = await fileToPart(currentPlanImage);
    const surveyPart = await fileToPart(surveyImage);

    const prompt = `You are an expert urban planner. The user wants to refine an existing site plan.
You are given:
1. The current site plan image to be modified.
2. The original site survey image for context and boundaries.
3. A text query with refinement instructions: "${query}"
4. Updated Site Plan Constraints.

Updated Constraints (Adhere Strictly):
- Maximum buildable coverage: ${datapoints.maxBuildableCoverage}%
- Minimum green coverage: ${datapoints.minGreenCoverage}%
- Minimum open space: ${datapoints.minOpenSpace}%
- Minimum lot size: ${datapoints.minLotSize} sq ft
- Minimum lot width: ${datapoints.minLotWidth} ft
- Setbacks: ${datapoints.frontSetback} ft (Front), ${datapoints.rearSetback} ft (Rear), ${datapoints.sideSetback} ft (Side)
- Road width: ${datapoints.roadWidth} ft
- Sidewalk width: ${datapoints.sidewalkWidth} ft

Instructions:
- Analyze the current site plan image.
- Modify it based *only* on the user's text query.
- Ensure the refined plan still respects the updated constraints and the original survey's boundaries.
- The output must be a new, clean, high-resolution PNG image of the refined site plan. The visual style should match the input plan.

Output: Return ONLY the refined site plan image. Do not return any text.`;
    
    const textPart = { text: prompt };

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [currentPlanPart, surveyPart, textPart] },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    console.log('Received refined site plan from model.', response);
    
    return handleImageApiResponse(response, 'refine site plan');
};


/**
 * Analyzes a site plan based on the image and datapoints.
 * @param sitePlanImage The generated site plan image file.
 * @param datapoints The detailed site parameters used for generation.
 * @returns A promise that resolves to the text of the analysis.
 */
export const analyzeSitePlan = async (
    sitePlanImage: File,
    datapoints: SiteDatapoints,
): Promise<string> => {
    console.log('Analyzing site plan with datapoints:', datapoints);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

    const planImagePart = await fileToPart(sitePlanImage);
    const prompt = `You are an expert urban planner and AI analyst. You are given a generated site plan image and the constraints that were used to create it. Your task is to provide a detailed analysis of the plan.

Site Plan Constraints Provided to the Generator:
- Maximum buildable coverage: ${datapoints.maxBuildableCoverage}%
- Minimum green coverage: ${datapoints.minGreenCoverage}%
- Minimum open space: ${datapoints.minOpenSpace}%
- Minimum lot size: ${datapoints.minLotSize} sq ft
- Minimum lot width: ${datapoints.minLotWidth} ft
- Setbacks: ${datapoints.frontSetback} ft (Front), ${datapoints.rearSetback} ft (Rear), ${datapoints.sideSetback} ft (Side)
- Road width: ${datapoints.roadWidth} ft
- Sidewalk width: ${datapoints.sidewalkWidth} ft

Analysis Instructions:
1.  **Constraint Compliance:** Visually inspect the site plan image. Does it appear to adhere to the provided constraints? Point out any potential discrepancies. Be specific (e.g., "The lots in the northwest corner appear smaller than the minimum size").
2.  **Pros:** Based on urban planning principles, what are the strengths of this layout? Consider traffic flow, lot arrangement, green space utilization, and overall efficiency.
3.  **Cons:** What are the weaknesses or potential problems with this layout? Consider dead ends, awkward lot shapes, inefficient use of space, or potential traffic bottlenecks.
4.  **Suggestions for Improvement:** Provide 2-3 actionable suggestions for how this plan could be improved. For example, "Consider adding a cul-de-sac to improve traffic flow in the residential area," or "The green space could be consolidated into a central park for better community access."

Format your response clearly with headings for each section (Constraint Compliance, Pros, Cons, Suggestions for Improvement). Be professional, concise, and constructive.`;
    
    const textPart = { text: prompt };

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [planImagePart, textPart] },
    });
    
    console.log('Received site plan analysis from model.');
    return response.text;
};