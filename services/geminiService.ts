/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { GoogleGenAI, GenerateContentResponse, Modality, Type } from "@google/genai";
import { SiteDatapoints } from "../types";

interface ChatMessageForPrompt {
  sender: 'bot' | 'user';
  text: string;
}

// Helper function to format chat history for the AI prompt
const formatChatHistory = (chatHistory: ChatMessageForPrompt[]): string => {
    return chatHistory.map(msg => `${msg.sender.toUpperCase()}: ${msg.text}`).join('\n\n');
};


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
    const prompt = `### ROLE ###
You are a specialist AI for cartographic data extraction. Your purpose is to accurately trace property boundaries from survey images with high precision.

### TASK ###
Your task is to analyze the provided survey image and produce a new image containing ONLY the primary, outermost legal property boundary.

### INSTRUCTIONS (CHAIN-OF-THOUGHT) ###
1.  **Analyze Image:** Scan the entire survey image to identify all lines and shapes.
2.  **Identify Boundary:** Distinguish the main property boundary from all other features (e.g., setback lines, easements, topographical contours, dimension lines, building footprints). The boundary is typically a thicker, continuous line forming a closed shape around the property.
3.  **Trace with Precision:** Carefully trace this single, closed polygon. The line must be continuous and connect back to itself perfectly.
4.  **Verify Output:** Ensure the final image contains nothing but the traced boundary line on a transparent background.

### OUTPUT REQUIREMENTS ###
-   **Content:** The output image MUST contain ONLY the single, closed polygon representing the property boundary.
-   **Line Style:** Solid red (#FF0000), 4 pixels thick.
-   **Background:** 100% transparent.
-   **Dimensions:** Must match the input survey image exactly.
-   **Format:** Produce ONLY the image as your final output. Do not respond with text, JSON, or any other format.`;

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

    const prompt = `### ROLE ###
You are a specialist AI image editor for cartographic data. You correct site boundary overlays based on user feedback with extreme precision.

### CONTEXT ###
You are given three images and one text instruction to perform a precise correction:
1.  **Survey Image:** The ground truth map showing the correct property lines. This is your reference for accuracy.
2.  **Current Boundary Image:** The existing red boundary line that contains an error. This is the image you will edit.
3.  **Mask Image:** A transparent image where the user has drawn in magenta. This highlights the specific Area of Interest (AOI) needing correction. Your edits should be focused here.
4.  **Text Query:** The user's explicit instruction: "${query}"

### TASK ###
Your task is to create a new, corrected boundary image. You will modify the 'Current Boundary Image' according to the user's feedback: ${query}, using the 'Survey Image' as a reference, focusing only on the area marked in the 'Mask Image'. The final result must be a single, seamless, closed polygon.

### INSTRUCTIONS (CHAIN-OF-THOUGHT) ${query} ###
1.  **Identify the Area of Interest (AOI):** Locate the magenta markings on the 'Mask Image'. This is the precise area where the correction must happen.
2.  **Analyze the User's Goal:** Read the 'Text Query' to understand what the user wants to achieve (e.g., "extend the line", "follow the curve", "remove this section").
3.  **Reference the Ground Truth:** Look at the 'Survey Image' within the AOI. Identify the correct property line feature that the user is referring to.
4.  **Synthesize the Correction:**
    *   Take the 'Current Boundary Image' as your base.
    *   In the AOI, erase the incorrect segment of the red line.
    *   Using the 'Survey Image' as a guide and following the 'Text Query', draw the new, corrected segment with high precision.
    *   **Seamless Integration (CRITICAL):** The new segment MUST connect perfectly to the unmodified parts of the original red line. The final output must be a single, unbroken, closed polygon with no gaps, overlaps, or artifacts at the connection points.
5.  **Final Verification:** The final image must contain a single, clean, closed red loop. Ensure there are no gaps or stray marks. The correction should only be within the AOI.

### OUTPUT REQUIREMENTS ###
*   **Content:** You MUST ONLY output the complete, corrected boundary line.
*   **Line Style:** A solid, continuous red (#FF0000) line, exactly 4 pixels thick.
*   **Background:** The background MUST be 100% transparent.
*   **Dimensions:** The output image dimensions MUST be identical to the input survey image.
*   **Format:** The final output is an image. DO NOT return any text.`;

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

**Instructions:**
1.  Identify the total property size (in acres or square feet).
2.  Note any significant features like existing structures, easements, major topographic changes (slopes, water), and the property shape.
3.  Format your response using Markdown. Start with the heading "### Site Survey Summary".
4.  Include a bulleted list of your findings.

**Example Response:**
### Site Survey Summary
Here is a brief analysis of the provided survey:
*   **Property Size:** 5.21 acres.
*   **Key Features:** It's a rectangular lot with a 20-foot utility easement on the northern boundary.
*   **Topography:** The terrain appears to be relatively flat.`;

    const textPart = { text: prompt };

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [surveyImagePart, textPart] },
    });

    console.log('Received survey summary from model.');
    return response.text;
};

/**
 * Gets AI-recommended site plan datapoints based on the chat history and survey image.
 * @param chatHistory The conversation history between the user and the bot.
 * @param surveyImage The site survey image file.
 * @returns A promise that resolves to a string containing reasoning and parameter recommendations.
 */
export const getSitePlanDatapoints = async (
    chatHistory: ChatMessageForPrompt[],
    surveyImage: File,
): Promise<string> => {
    console.log('Getting site plan datapoint recommendations from chat history and survey image...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const surveyImagePart = await fileToPart(surveyImage);
    const formattedHistory = formatChatHistory(chatHistory);

    const prompt = `You are an expert urban planner. You are tasked with recommending initial site plan parameters based on a conversation transcript and a site survey image.

**Conversation Transcript:**
---
${formattedHistory}
---

**Your task is twofold:**
1.  First, based on the entire conversation (including the initial survey summary and the user's stated goals) AND a visual analysis of the provided **site survey image**, provide a reasoning paragraph. Reference visual elements from the image (e.g., shape of the lot, visible topography, existing structures) in your reasoning. **Use Markdown for formatting**.
2.  After your reasoning paragraph, output the parameters. The output format for the parameters MUST be exactly as follows, starting with "- Coverage Constraints:", with only numbers after each colon.

---
EXAMPLE RESPONSE STRUCTURE:
Based on the **irregular shape** of the lot visible in the survey and the goal to **maximize lot yield**, I recommend a smaller minimum lot size to fit more parcels. The **flat terrain** allows for a standard road width, and the utility easement on the northern boundary will be respected.

- Coverage Constraints:
    - Maximum buildable coverage (%): 55
    - Minimum green coverage (%): 15
    - Minimum open space (%): 15
- Lot Standards:
    - Minimum lot size (sq ft): 4500
    - Minimum lot width (ft): 45
- Setback Requirements:
    - Front (ft): 20
    - Rear (ft): 20
    - Side (ft): 10
- Infrastructure Specifications:
    - Road width (ft): 24
    - Sidewalk width (ft): 5
---

Your actual response must follow this structure. Start with your reasoning, then provide the formatted parameter list. Do not include the "EXAMPLE RESPONSE STRUCTURE" or "---" markers in your output.`;

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [surveyImagePart, { text: prompt }] },
    });

    console.log('Received datapoint recommendations from model based on chat history and image.');
    return response.text;
};

/**
 * Extracts the total area and unit from a survey image.
 * @param surveyImage The site survey image file.
 * @param boundaryImage The site boundary overlay image file.
 * @returns A promise that resolves to an object with area and unit.
 */
export const getSiteArea = async (
    surveyImage: File,
    boundaryImage: File,
): Promise<{ area: number; unit: 'sqft' | 'acre' | 'hectare' }> => {
    console.log('Getting site area...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

    const surveyImagePart = await fileToPart(surveyImage);
    const boundaryImagePart = await fileToPart(boundaryImage);

    const schema = {
        type: Type.OBJECT,
        properties: {
            area: { type: Type.NUMBER, description: "The calculated total area of the property." },
            unit: { type: Type.STRING, description: "The unit of measurement. Must be one of: 'sqft', 'acre', 'hectare'." }
        },
        required: ["area", "unit"]
    };

    const prompt = `You are an expert AI cartographer and surveyor's assistant.
Your task is to analyze a survey image and a boundary overlay to determine the total area of the property.

### INPUT IMAGES ###
1.  **Survey Image:** The base map. Look for scale bars, north arrows, and written area statements (e.g., "Total Area = 5.21 AC.").
2.  **Boundary Image:** A red polygon outlining the exact property. Your calculation must be for the area within this polygon.

### INSTRUCTIONS (CHAIN-OF-THOUGHT) ###
1.  **Analyze Survey for Scale/Area:** First, scrutinize the entire survey image for any explicit statements of total area or a graphical scale bar. This is the most reliable source.
2.  **Calculate Area:** If an area is explicitly stated, use that number. If not, use the scale bar and the boundary polygon to estimate the area.
3.  **Identify Unit:** Determine the unit of measurement (square feet, acres, or hectares). Return one of: 'sqft', 'acre', or 'hectare'.
4.  **Format Output:** Return the data in a structured JSON format matching the provided schema.

Return ONLY the JSON object. Do not add any other text or markdown.`;

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [surveyImagePart, boundaryImagePart, { text: prompt }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: schema,
        },
    });

    console.log('Received site area from model.');
    const resultJson = JSON.parse(response.text);

    // Basic validation
    if (typeof resultJson.area !== 'number' || !['sqft', 'acre', 'hectare'].includes(resultJson.unit)) {
        throw new Error('Invalid area data received from model.');
    }
    
    return resultJson;
};


/**
 * Generates a site plan image from a site survey image.
 * @param boundaryImage The site boundary overlay image file.
 * @param accessPointsImage Optional image with user-marked access points.
 * @param purpose The purpose of the project (e.g., "Commercial").
 * @param priority The main design priority (e.g., "Maximize Lot Yield").
 * @param datapoints The detailed site parameters.
 * @param networkType The type of road network to generate.
 * @param lotCountRange The required range for the number of lots.
 * @param numberOfEntrances The number of entrances if access points aren't manually specified.
 * @param hasPonds Whether the site has ponds that must be preserved.
 * @param culDeSacAllowed Whether cul-de-sacs are allowed in the design.
 * @param totalSiteArea The total area of the site in square feet.
 * @param minLotSizePercentage The minimum lot size as a percentage of the total site area.
 * @returns A promise that resolves to the data URL of the generated site plan image.
 */
export const generateSitePlan = async (
    boundaryImage: File,
    accessPointsImage: File | null,
    purpose: string,
    priority: string,
    datapoints: SiteDatapoints,
    networkType: string,
    lotCountRange: { min: number, max: number },
    numberOfEntrances: number | null,
    hasPonds: boolean | null,
    culDeSacAllowed: boolean,
    totalSiteArea: number,
    minLotSizePercentage: number,
): Promise<string> => {
    console.log(`Starting site plan generation for ${networkType} network with lot range ${lotCountRange.min}-${lotCountRange.max}...`);
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const boundaryImagePart = await fileToPart(boundaryImage);
    const parts = [boundaryImagePart];
    
    let accessPointsPrompt = '';
    if (accessPointsImage) {
        const accessPointsPart = await fileToPart(accessPointsImage);
        parts.push(accessPointsPart);
        accessPointsPrompt = `The road network MUST connect to the access points marked with blue circles in the provided image. This is a critical requirement.`
    } else if (numberOfEntrances !== null) {
        accessPointsPrompt = `The site plan MUST have exactly ${numberOfEntrances} road entrances connecting to the site's perimeter. The AI should determine the optimal locations for these entrances.`
    }
    
    let specialConditions = [];
    if (hasPonds) {
        specialConditions.push('The site contains one or more ponds or significant water bodies. You MUST incorporate these natural features into the design, designing the road network and lots around them. Do not place any development over existing water features visible in the survey.');
    }
    if (!culDeSacAllowed) {
        specialConditions.push('The use of cul-de-sacs (dead-end streets) is strictly PROHIBITED. All roads must connect to other roads to form a continuous, flowing network without dead ends.');
    }
    
    const prompt = `You are an expert AI urban planner. Your task is to generate a professional site plan based on a set of images and constraints.

### CONTEXT & GOALS ###
-   **Project Purpose:** ${purpose}
-   **Design Priority:** ${priority}
-   **Road Network Style:** ${networkType}

### INPUT IMAGES ###
1.  **Boundary Image:** A red polygon showing the exact development boundary. All development MUST be STRICTLY and ENTIRELY contained within this polygon. This is your primary spatial reference.
${accessPointsImage ? "2. **Access Points Image:** Blue circles mark MANDATORY road connection points.\n" : ""}

### CORE INSTRUCTIONS (CHAIN-OF-THOUGHT) ###
1.  **Analyze Site & Constraints:** Review the boundary image and the critical lot count requirement below.
2.  **Design Layout:**
    *   Start by laying out the **${networkType} road network**. It must be efficient and connect to the mandatory access points if provided.
    *   Subdivide the remaining area into lots, ensuring each lot meets the minimum size and width requirements.
    *   Arrange lots logically along the roads.
    *   Allocate required green space and open space.
    *   **Full Land Utilization (CRITICAL):** The entire area inside the boundary polygon must be fully utilized. It should be completely filled with designated lots (buildable area), roads, green space, or open space. No unassigned or empty areas are allowed.
    *   **CRITICAL:** Ensure all elements (roads, lots, green space) are entirely INSIDE the red boundary polygon. Nothing should touch or cross the boundary line.
3.  **Final Validation (Self-Correction - STRICT):** Before creating the final image, you MUST validate your design against these rules:
    *   **Lot Count Check (CRITICAL):** Count the total number of lots in your design. Does the number fall between ${lotCountRange.min} and ${lotCountRange.max}? If not, YOU MUST REDESIGN the layout (adjust road length, lot sizes, green space) until the lot count is within this required range.
    *   **Boundary Check:** Is everything strictly inside the red boundary? There should be a clear buffer between the development and the red line.
    *   **Access Point Check:** Does the road network connect to all access points?
    *   **Priority Check:** Does the layout align with the user's priority (${priority})?
    *   **Setback Check:** Does the placement of roads and green spaces respect the required setbacks for each lot?
    *   Do not output an image until all validation checks pass, especially the lot count.

### ZONING & INFRASTRUCTURE REQUIREMENTS (STRICT) ###
-   **Total Site Area:** ${totalSiteArea.toFixed(0)} sq ft
-   **Required Lot Count:** Between ${lotCountRange.min} and ${lotCountRange.max} lots.
-   Max Buildable Coverage: ${datapoints.maxBuildableCoverage}%
-   Min Green Coverage: ${datapoints.minGreenCoverage}%
-   Min Open Space: ${datapoints.minOpenSpace}%
-   Min Lot Size: ${datapoints.minLotSize} sq ft
-   Min Lot Width: ${datapoints.minLotWidth} ft
-   Setbacks: ${datapoints.frontSetback} ft (Front), ${datapoints.rearSetback} ft (Rear), ${datapoints.sideSetback} ft (Side). **CRITICAL**: These setbacks define the buildable area *within* each lot. You MUST ensure that no part of the road network or any common green/open space encroaches upon these required setback areas. Roads and common spaces must be placed outside of the setback buffer of any given lot.
-   Road Width: ${datapoints.roadWidth} ft
-   Sidewalk Width: ${datapoints.sidewalkWidth} ft
-   ${accessPointsPrompt}
${specialConditions.length > 0 ? specialConditions.map(c => `-   ${c}`).join('\n') : ''}

### OUTPUT REQUIREMENTS ###
-   **Format:** A clean, high-resolution, top-down 2D site plan image.
-   **Styling:** Use clear visual distinctions: black for roads, green for green spaces, and gray for lots.
-   **Lot Numbering (CRITICAL):** You MUST add a number to each individual lot. The numbers should be sequential (1, 2, 3, etc.), written in a clear, legible white font, and placed in the center of each lot. Ensure the numbers are large enough to be readable but do not overlap with lot boundaries or roads.
-   **Site Boundary Line (CRITICAL):** You MUST draw a single, continuous line that follows the exact perimeter of the entire developed site (i.e., the outermost edge of all lots, roads, and green spaces). This line should be red (#FF0000), 3 pixels thick, and must be positioned just inside the main red boundary provided in the input image. This visually separates the developed area from any surrounding undeveloped land within the property parcel.
-   **Building Footprints (CRITICAL):** Inside EACH individual lot, you must draw the buildable area outline. This outline MUST be a simple, centered rectangle. The edges of this rectangle must be positioned exactly according to the ${datapoints.frontSetback} ft front, ${datapoints.rearSetback} ft rear, and ${datapoints.sideSetback} ft side setback requirements. The outline itself should be a thin, dashed white line (2 pixels thick).
-   **Content:** Return ONLY the final site plan image. Do not return any text.`;
    
    const textPart = { text: prompt };

    console.log('Sending boundary image and prompt to the model...');
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
            frontSetback: { type: Type.NUMBER },
            rearSetback: { type: Type.NUMBER },
            sideSetback: { type: Type.NUMBER },
            roadWidth: { type: Type.NUMBER },
            sidewalkWidth: { type: Type.NUMBER },
        },
        required: [
            "maxBuildableCoverage", "minGreenCoverage", "minOpenSpace",
            "minLotSize", "minLotWidth", "frontSetback",
            "rearSetback", "sideSetback", "roadWidth", "sidewalkWidth"
        ]
    };

    const prompt = `Analyze the user's query and update the provided JSON object of site parameters.
- User Query: "${query}"
- Current Parameters: ${JSON.stringify(currentDatapoints, null, 2)}

Instructions:
1. Read the user's query to identify any requests to change specific parameters. For example, "make the lots bigger" implies increasing 'minLotSize'. "increase side setbacks to 15 feet" implies setting 'sideSetback' to 15.
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
 * @param boundaryImage The site boundary overlay image file.
 * @param query The user's text instructions for refinement.
 * @param datapoints The updated detailed site parameters.
 * @param accessPointsImage Optional image with user-marked access points.
 * @param maskImage Optional image with user's drawings to guide refinement.
 * @returns A promise that resolves to the data URL of the refined site plan image.
 */
export const refineSitePlan = async (
    currentPlanImage: File,
    boundaryImage: File,
    query: string,
    datapoints: SiteDatapoints,
    accessPointsImage: File | null,
    maskImage: File | null,
): Promise<string> => {
    console.log('Refining site plan with user query and new datapoints...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const currentPlanPart = await fileToPart(currentPlanImage);
    const boundaryPart = await fileToPart(boundaryImage);
    const parts = [currentPlanPart, boundaryPart];

    let accessPointsPromptSegment = '';
    if (accessPointsImage) {
        const accessPointsPart = await fileToPart(accessPointsImage);
        parts.push(accessPointsPart);
        accessPointsPromptSegment = `
**Road Access Points:** You are also given an image with blue circles indicating mandatory road access points.
- The refined road network MUST connect to these points.`;
    }

    let maskPromptSegment = '';
    if (maskImage) {
        const maskPart = await fileToPart(maskImage);
        parts.push(maskPart);
        maskPromptSegment = `
**User Drawing (Mask):** You have also been provided with a mask image where the user has drawn in magenta. This indicates the precise area of interest for the changes described in the query. You MUST focus your edits on these marked areas.`;
    }

    const prompt = `You are an expert urban planner. The user wants to refine an existing site plan.
You are given:
1. The current site plan image to be modified.
2. The site boundary image (a red polygon). All development must remain STRICTLY within this boundary.
3. A text query with refinement instructions: "${query}"
4. Updated Site Plan Constraints.
${accessPointsPromptSegment}
${maskPromptSegment}

**Core Planning Principles:** As you apply the user's query, also adhere to these core principles for the road network:
- Optimize traffic flow and connectivity throughout the site.
- Minimize dead-end streets where possible, unless creating a deliberate cul-de-sac for residential areas.
- Intelligently incorporate cul-de-sacs or roundabouts where they would improve traffic circulation or lot arrangement.
- **Full Land Utilization:** The entire area inside the boundary polygon must be fully utilized. It should be completely filled with designated lots (buildable area), roads, green space, or open space. After your edits, ensure no unassigned or empty areas remain.

Updated Constraints (Adhere Strictly):
- Maximum buildable coverage: ${datapoints.maxBuildableCoverage}%
- Minimum green coverage: ${datapoints.minGreenCoverage}%
- Minimum open space: ${datapoints.minOpenSpace}%
- Minimum lot size: ${datapoints.minLotSize} sq ft
- Minimum lot width: ${datapoints.minLotWidth} ft
- Setbacks: ${datapoints.frontSetback} ft (Front), ${datapoints.rearSetback} ft (Rear), ${datapoints.sideSetback} ft (Side). **CRITICAL**: Your modifications must respect these setbacks. Roads and common green spaces must not be placed within the setback areas of individual lots.
- Road width: ${datapoints.roadWidth} ft
- Sidewalk width: ${datapoints.sidewalkWidth} ft

Instructions:
- Analyze the current site plan image.
- Modify it based on the user's text query. The query may contain both visual instructions (e.g., "add a park") and parameter changes (e.g., "make lots bigger"). Prioritize instructions in the query.
- If a user mask is provided, use it to guide where the changes should be made. The magenta marks show where to focus.
- While implementing the changes, ensure the entire plan adheres to the **Core Planning Principles** mentioned above.
- **Lot Numbering:** After applying changes, re-number all lots sequentially (1, 2, 3...). The numbers must be clear, legible, in a white font, and centered within each lot.
- **CRITICAL**: The refined plan MUST respect all updated constraints and be contained ENTIRELY within the provided red boundary polygon. Nothing should touch or cross the boundary line. It must also respect mandatory access points if provided.
- The output must be a new, clean, high-resolution PNG image of the refined site plan. The visual style must be consistent: black for roads, green for green spaces, gray for lots.
- **Site Boundary Line:** The refined plan MUST include a continuous 3-pixel thick red (#FF0000) line enclosing the entire developed site just inside the red boundary.
- **Building Footprints (CRITICAL):** Inside EACH lot, you MUST include a simple, rectangular building footprint outline. This outline must be a thin, dashed white line (2 pixels thick) and must be positioned to respect the ${datapoints.frontSetback} ft front, ${datapoints.rearSetback} ft rear, and ${datapoints.sideSetback} ft side setbacks.

Output: Return ONLY the refined site plan image. Do not return any text.`;
    
    const textPart = { text: prompt };

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [...parts, textPart] },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    console.log('Received refined site plan from model.', response);
    
    return handleImageApiResponse(response, 'refine site plan');
};

/**
 * Automatically improves the road network of a site plan.
 * @param currentPlanImage The current site plan image file.
 * @param boundaryImage The site boundary overlay image file.
 * @param datapoints The detailed site parameters.
 * @param accessPointsImage Optional image with user-marked access points.
 * @returns A promise that resolves to the data URL of the improved site plan image.
 */
export const autoImproveRoadNetwork = async (
    currentPlanImage: File,
    boundaryImage: File,
    datapoints: SiteDatapoints,
    accessPointsImage: File | null,
): Promise<string> => {
    console.log('Auto-improving road network...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

    const currentPlanPart = await fileToPart(currentPlanImage);
    const boundaryPart = await fileToPart(boundaryImage);
    const parts = [currentPlanPart, boundaryPart];

    let accessPointsPromptSegment = '';
    if (accessPointsImage) {
        const accessPointsPart = await fileToPart(accessPointsImage);
        parts.push(accessPointsPart);
        accessPointsPromptSegment = `
- **Mandatory Access Points:** The refined road network MUST continue to connect to the access points marked with blue circles. Preserving these connections is critical.`;
    }

    const prompt = `### ROLE ###
You are an expert AI traffic engineer and urban planner. Your task is to analyze an existing site plan and generate a revised version with an improved road network.

### CONTEXT ###
You are given the current site plan and the site boundary image (a red polygon). Your goal is to improve the road network for efficiency, safety, aesthetic appeal, and pedestrian-friendliness while adhering to all original zoning constraints and staying STRICTLY inside the boundary.

### ANALYSIS & IMPROVEMENT GOALS (CHAIN-OF-THOUGHT) ###
1.  **Analyze Existing Network:** Scrutinize the road layout in the 'current site plan'. Identify areas for improvement:
    *   **Inefficiency:** Are there overly long roads, awkward intersections, or poor connectivity?
    *   **Safety:** Are there opportunities for traffic calming? Could cul-de-sacs be added to residential areas to reduce through-traffic? Are intersections clear and safe?
    *   **Aesthetics & Pedestrians:** Does the layout feel rigid or uninspired? Can you add gentle curves, roundabouts, or green medians? Can pedestrian connectivity be improved with more logical sidewalk paths or crosswalks?
2.  **Generate Improvements:** Based on your analysis, redesign the road network. All new roads must be within the provided red boundary.
    *   Introduce traffic calming measures like cul-de-sacs or roundabouts where appropriate.
    *   Optimize intersections for better flow.
    *   Improve the overall aesthetic feel of the road layout.
3.  **Re-integrate Lots & Green Space:** After redesigning the roads, re-layout the lots and green spaces around the new network. All lots must still have road access.
4.  **Final Validation:** Ensure the new plan STILL STRICTLY ADHERES to all the original constraints provided below AND is entirely contained within the red boundary. Also verify every lot is clearly numbered.

### CONSTRAINTS (MUST ADHERE) ###
-   **Boundary:** All development MUST be strictly and entirely contained within the red polygon from the boundary image.
-   Max Buildable Coverage: ${datapoints.maxBuildableCoverage}%
-   Min Green Coverage: ${datapoints.minGreenCoverage}%
-   Min Open Space: ${datapoints.minOpenSpace}%
-   Min Lot Size: ${datapoints.minLotSize} sq ft
-   Min Lot Width: ${datapoints.minLotWidth} ft
-   Setbacks: ${datapoints.frontSetback} ft (Front), ${datapoints.rearSetback} ft (Rear), ${datapoints.sideSetback} ft (Side). **CRITICAL**: When re-laying out lots, you must strictly adhere to these setbacks. Ensure no common areas or roads encroach upon the setback zones of the lots.
-   Road Width: ${datapoints.roadWidth} ft
-   Sidewalk Width: ${datapoints.sidewalkWidth} ft
${accessPointsPromptSegment}

### OUTPUT REQUIREMENTS ###
-   **Format & Styling:** A clean, high-resolution, top-down 2D site plan image with a consistent visual style: black for roads, green for green spaces, gray for lots, and a continuous 3-pixel thick red (#FF0000) line enclosing the entire developed site just inside the red boundary.
-   **Lot Numbering (CRITICAL):** Each lot in the output image must be clearly labeled with a sequential number (1, 2, 3, etc.) in a legible white font, centered on the lot.
-   **Building Footprints (CRITICAL):** Inside EACH re-laid out lot, you must draw the buildable area outline. This outline MUST be a simple, centered rectangle. The edges of this rectangle must be positioned exactly according to the ${datapoints.frontSetback} ft front, ${datapoints.rearSetback} ft rear, and ${datapoints.sideSetback} ft side setback requirements. The outline itself should be a thin, dashed white line (2 pixels thick).
-   **Content:** Return ONLY the final revised site plan image. Do not return any text.`;
    
    const textPart = { text: prompt };

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image-preview',
        contents: { parts: [...parts, textPart] },
        config: { responseModalities: [Modality.IMAGE, Modality.TEXT] },
    });
    console.log('Received auto-improved site plan from model.', response);
    
    return handleImageApiResponse(response, 'auto-improve road network');
};


/**
 * Analyzes a site plan based on the image and datapoints, and streams the result.
 * @param sitePlanImage The generated site plan image file.
 * @param datapoints The detailed site parameters used for generation.
 * @returns An async generator that yields chunks of the analysis text.
 */
export const analyzeSitePlan = async function* (
    sitePlanImage: File,
    datapoints: SiteDatapoints,
): AsyncGenerator<string> {
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

Format your response using Markdown. Use headings (e.g., \`## Constraint Compliance\`), bold text, and lists to structure your analysis clearly. Be professional, concise, and constructive.`;
    
    const textPart = { text: prompt };

    const responseStream = await ai.models.generateContentStream({
        model: 'gemini-2.5-flash',
        contents: { parts: [planImagePart, textPart] },
    });
    
    for await (const chunk of responseStream) {
        yield chunk.text;
    }

    console.log('Finished streaming site plan analysis.');
};

/**
 * Generates suggestions for how to refine a site boundary based on chat history and the survey image.
 * @param chatHistory The conversation history between the user and the bot.
 * @param surveyImage The site survey image file.
 * @returns A promise that resolves to an array of 3 string suggestions.
 */
export const getBoundaryRefinementSuggestions = async (
    chatHistory: ChatMessageForPrompt[],
    surveyImage: File,
): Promise<string[]> => {
    console.log('Getting boundary refinement suggestions from chat history and survey image...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
    
    const surveyImagePart = await fileToPart(surveyImage);
    const formattedHistory = formatChatHistory(chatHistory);

    const prompt = `You are an AI assistant for a land surveyor. You are reviewing a conversation about a site plan and have been provided the survey image.
Your task is to analyze the entire conversation and the survey image to identify potential areas where an AI's initial site boundary detection might be inaccurate. Based on both the textual description of the property and visual features in the image, provide 3 short, actionable text queries a user could write to correct the boundary.
The user will be using a drawing tool to mark the area, and your query will accompany their drawing. The queries should be concise, direct commands to an image editing AI.

**Conversation Transcript:**
---
${formattedHistory}
---

**Instructions:**
- Read the conversation and visually inspect the survey image.
- Look for clues in the text (e.g., "bordered by a creek") and find the corresponding visual feature in the image.
- Look for visual features that might be misidentified, like easements, setback lines, or curved boundaries.
- Create 3 distinct suggestions for refining the boundary based on these combined textual and visual clues.

Return ONLY a valid JSON array of exactly 3 strings. Do not include markdown backticks or any other text.

Example response (if survey image shows a creek and text mentions it):
["Extend the boundary to the northernmost corner as shown on the survey.", "The western side should follow the creek line, not a straight line.", "Make sure the boundary does not include the utility easement on the north side."]`

    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [surveyImagePart, { text: prompt }] },
    });

    console.log('Received boundary suggestions from model based on chat history and image.');
    try {
        // Handle cases where the model might wrap the JSON in markdown backticks
        const jsonStr = response.text.trim().replace(/^```json\s*|```\s*$/g, '');
        const resultJson = JSON.parse(jsonStr);
        // Validate the parsed structure before returning
        if (Array.isArray(resultJson) && resultJson.every(item => typeof item === 'string')) {
            return resultJson;
        } else {
             console.error("Parsed JSON is not an array of strings:", resultJson);
             return [];
        }
    } catch (e) {
        console.error("Failed to parse JSON suggestions from model response:", e, "Response text:", response.text);
        return []; // Return empty array on failure
    }
};

/**
 * Generates suggestions for how to refine a site plan based on chat history and the current plan image.
 * @param chatHistory The conversation history between the user and the bot.
 * @param sitePlanImage The current site plan image file.
 * @returns A promise that resolves to an array of 3 string suggestions.
 */
export const getPlanRefinementSuggestions = async (
    chatHistory: ChatMessageForPrompt[],
    sitePlanImage: File,
): Promise<string[]> => {
    console.log('Getting plan refinement suggestions from chat history and site plan image...');
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });

    const planImagePart = await fileToPart(sitePlanImage);
    const formattedHistory = formatChatHistory(chatHistory);
    
    const prompt = `You are an expert AI urban planner. Your task is to analyze a conversation and the current site plan image to provide 3 creative, actionable suggestions for the user's next refinement step.

**Conversation Transcript:**
---
${formattedHistory}
---

**Your Instructions:**
1.  **Analyze the Conversation and the Current Plan:** Carefully review the transcript to understand the project's history, goals (purpose and priority), and any previous refinement steps. Simultaneously, visually analyze the provided site plan image for its strengths and weaknesses (e.g., traffic flow, green space distribution, lot shapes).
2.  **Align with Goals and Visuals:** Generate suggestions that directly support the user's stated goals AND address observations from the visual plan.
    - If Priority is "Maximize Lot Yield", and the plan shows awkward empty spaces, suggest ways to reconfigure lots to use that space.
    - If Purpose is "Residential" and the plan shows one small park, suggest consolidating green space or adding walking paths.
    - If the plan shows long, straight roads, suggest traffic calming measures like a roundabout.
3.  **Focus on Actionable Changes:** Your suggestions must be phrased as direct, actionable commands for an AI. They should describe **structural or visual changes** (e.g., adding features, reconfiguring roads) rather than simple parameter adjustments (e.g., "increase lot size"). The user will also have a form to change parameters, so your suggestions should be about things that cannot be done in the form.

**Output Requirements:**
- Return ONLY a valid JSON array of exactly 3 distinct string suggestions. Do not include markdown backticks or any other text.

**Example (for a "Residential" / "Balanced Layout" project):**
["Consolidate the separate green spaces into a single, central community park.", "Add a cul-de-sac at the end of the northernmost road to improve safety and create premium lots.", "Connect the two dead-end streets on the west side to create a continuous loop for better traffic flow."]`
    
    const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [planImagePart, { text: prompt }] },
    });
    
    console.log('Received plan suggestions from model based on chat history and image.');
    try {
        // Handle cases where the model might wrap the JSON in markdown backticks
        const jsonStr = response.text.trim().replace(/^```json\s*|```\s*$/g, '');
        const resultJson = JSON.parse(jsonStr);
        // Validate the parsed structure before returning
        if (Array.isArray(resultJson) && resultJson.every(item => typeof item === 'string')) {
            return resultJson;
        } else {
             console.error("Parsed JSON is not an array of strings:", resultJson);
             return [];
        }
    } catch (e) {
        console.error("Failed to parse JSON suggestions from model response:", e, "Response text:", response.text);
        return []; // Return empty array on failure
    }
};