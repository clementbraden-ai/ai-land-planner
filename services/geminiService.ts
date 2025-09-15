/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, GenerateContentResponse, Modality, Type } from "@google/genai";
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
 * @param boundaryImage The current boundary overlay to be edited.
 * @param maskImage The user's drawing on a transparent canvas.
 * @param query The user's text instructions.
 * @returns A promise that resolves to the data URL of the new boundary overlay image.
 */
export const refineSiteBoundary = async (
    surveyImage: File,
    boundaryImage: File,
    maskImage: File,
    query: string
): Promise<string> => {
    console.log('Refining site boundary with user input...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const surveyPart = await fileToPart(surveyImage);
    const boundaryPart = await fileToPart(boundaryImage);
    const maskPart = await fileToPart(maskImage);

    const prompt = `You are an expert image editor specializing in site surveys. The user wants to refine a detected site boundary.
You are given four inputs:
1. The original site survey image (for context).
2. The current boundary image (a red line on a transparent background). This is the image that needs to be edited.
3. A mask image where the user has drawn to indicate corrections.
4. A text query with instructions.

Your task is to use the user's feedback (mask and query) to modify the current boundary image.

Instructions:
- Use the original survey for context only (to see the underlying lines).
- Start with the current boundary image.
- Modify the red line based on the areas highlighted in the mask image and the instructions in the user's text query: "${query}"
- The output must be a transparent PNG with only a single, clean, red line representing the corrected boundary.
- The output image dimensions must match the original survey image.

Output: Return ONLY the final image. Do not return any text.`;

    const textPart = { text: prompt };
    
    console.log('Sending survey, current boundary, mask, and query to the model...');
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [surveyPart, boundaryPart, maskPart, textPart] },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    console.log('Received refined boundary response from model.', response);

    return handleImageApiResponse(response, 'refine site boundary');
};


/**
 * Analyzes a survey image to get a summary.
 * @param surveyImage The site survey image file.
 * @returns A promise that resolves to the text summary.
 */
export const getSurveySummary = async (surveyImage: File): Promise<string> => {
    console.log('Getting survey summary...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    const surveyImagePart = await fileToPart(surveyImage);
    
    const prompt = `You are a professional land surveyor's assistant. Analyze the provided site survey image. Your task is to extract key information and provide a concise summary. 

Instructions:
1.  Identify the total property size (in acres or square feet, whichever is more appropriate from the survey). State this clearly.
2.  Note any significant features like existing structures, easements, major topographic changes (like steep slopes or bodies of water), and the general shape of the property.
3.  Present this as a brief, easy-to-understand summary paragraph.
4.  Start your response with "Here's a summary of my analysis:".

Example: "Here's a summary of my analysis: The property is approximately 5.2 acres in size. It appears to be a rectangular lot with a significant utility easement running along the northern boundary. The terrain seems relatively flat based on the contour lines."`;

    const textPart = { text: prompt };

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [surveyImagePart, textPart] },
    });

    console.log('Received survey summary from model.');
    return response.text;
};

/**
 * Gets AI-recommended site plan datapoints based on a survey image.
 * @param surveyImage The site survey image file.
 * @param purpose The purpose of the project.
 * @param priority The main design priority.
 * @param summary The pre-computed summary of the site survey.
 * @returns A promise that resolves to a string containing reasoning and parameter recommendations.
 */
export const getSitePlanDatapoints = async (
    surveyImage: File,
    purpose: string,
    priority: string,
    summary: string,
): Promise<string> => {
    console.log('Getting site plan datapoint recommendations...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    const surveyImagePart = await fileToPart(surveyImage);
    
    const prompt = `You are an expert urban planner. You have already analyzed a site survey and provided the following summary: "${summary}". 

Now, based on that summary and the user's goals, provide recommended parameters for the site plan.

User Goals:
- Project Purpose: ${purpose}
- Design Priority: ${priority}

Your task is twofold:
1.  First, provide a reasoning paragraph explaining *why* you are recommending certain parameters. Link your reasoning to the survey summary and the user's goals. For example, for 'Maximize Lot Yield' on a large, flat property, you'd recommend a smaller minimum lot size.
2.  After your reasoning paragraph, output the parameters. The output format for the parameters MUST be exactly as follows, starting with "- Coverage Constraints:", with only numbers after each colon.

---
EXAMPLE RESPONSE STRUCTURE:
Based on the 5.2-acre property size and the goal to maximize lot yield for a residential project, I recommend a smaller minimum lot size to increase the number of homes. The flat terrain allows for a standard road width, and the utility easement on the northern boundary will be respected by ensuring adequate setbacks.

- Coverage Constraints:
    - Maximum buildable coverage (%): 55
    - Minimum green coverage (%): 15
    - Minimum open space (%): 15
- Lot Standards:
    - Minimum lot size (sq ft): 4500
    - Minimum lot width (ft): 45
    - Minimum number of lots: 20
- Setback Requirements:
    - Front (ft): 20
    - Rear (ft): 20
    - Side (ft): 10
- Infrastructure Specifications:
    - Road width (ft): 24
    - Sidewalk width (ft): 5
---

Your actual response must follow this structure. Start with your reasoning, then provide the formatted parameter list. Do not include the "EXAMPLE RESPONSE STRUCTURE" or "---" markers in your output.`;

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
- Minimum number of lots: ${datapoints.minNumLots}
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
 * Updates site datapoints based on a natural language query.
 * @param query The user's text instructions for refinement.
 * @param currentDatapoints The current site parameters.
 * @returns A promise that resolves to the updated site datapoints object.
 */
export const updateDatapointsFromQuery = async (
    query: string,
    currentDatapoints: SiteDatapoints
): Promise<SiteDatapoints> => {
    console.log('Updating datapoints from query...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

    const schema = {
        type: Type.OBJECT,
        properties: {
            maxBuildableCoverage: { type: Type.NUMBER },
            minGreenCoverage: { type: Type.NUMBER },
            minOpenSpace: { type: Type.NUMBER },
            minLotSize: { type: Type.NUMBER },
            minLotWidth: { type: Type.NUMBER },
            minNumLots: { type: Type.NUMBER },
            frontSetback: { type: Type.NUMBER },
            rearSetback: { type: Type.NUMBER },
            sideSetback: { type: Type.NUMBER },
            roadWidth: { type: Type.NUMBER },
            sidewalkWidth: { type: Type.NUMBER },
        },
        required: [
            "maxBuildableCoverage", "minGreenCoverage", "minOpenSpace",
            "minLotSize", "minLotWidth", "minNumLots", "frontSetback",
            "rearSetback", "sideSetback", "roadWidth", "sidewalkWidth"
        ]
    };

    const prompt = `Analyze the user's query and update the provided JSON object of site parameters.
- User Query: "${query}"
- Current Parameters: ${JSON.stringify(currentDatapoints, null, 2)}

Instructions:
1. Read the user's query to identify any requests to change specific parameters. For example, "make the lots bigger" implies increasing 'minLotSize'. "I need 50 lots" implies setting 'minNumLots' to 50.
2. If a parameter is explicitly mentioned or clearly implied in the query, update its value in the JSON object.
3. For any parameter NOT mentioned in the query, you MUST keep its original value from the "Current Parameters".
4. Return the complete, updated JSON object. The structure of your response must exactly match the provided schema. Do not return any other text or explanations.`;
    
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
            responseMimeType: "application/json",
            responseSchema: schema,
        },
    });
    
    console.log('Received updated datapoints from model.');
    const resultJson = JSON.parse(response.text);
    return resultJson as SiteDatapoints;
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
- Minimum number of lots: ${datapoints.minNumLots}
- Setbacks: ${datapoints.frontSetback} ft (Front), ${datapoints.rearSetback} ft (Rear), ${datapoints.sideSetback} ft (Side)
- Road width: ${datapoints.roadWidth} ft
- Sidewalk width: ${datapoints.sidewalkWidth} ft

Instructions:
- Analyze the current site plan image.
- Modify it based on the user's text query. The query may contain both visual instructions (e.g., "add a park") and parameter changes (e.g., "make lots bigger"). Prioritize instructions in the query.
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
- Minimum number of lots: ${datapoints.minNumLots}
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