/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useState, useCallback, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { generateSitePlan, getSitePlanDatapoints, detectSiteBoundary, refineSiteBoundary, analyzeSitePlan, refineSitePlan, getSurveySummary, updateDatapointsFromQuery, getBoundaryRefinementSuggestions, getPlanRefinementSuggestions, getSiteArea } from './services/geminiService';
import { SiteDatapoints } from './types';
import Header from './components/Header';
import Spinner from './components/Spinner';
import StartScreen from './components/StartScreen';
import DatapointsForm from './components/DatapointsForm';
import BoundaryEditor from './components/BoundaryEditor';
import AccessPointEditor from './components/AccessPointEditor';
import PlanOptions from './components/PlanOptions';
import PlanRefiner from './components/PlanRefiner';
import SitePlanEditor from './components/SitePlanEditor';
import { UploadIcon, MagicWandIcon, RobotIcon, CheckIcon, PencilIcon } from './components/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Set worker source for pdf.js
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@4.5.136/build/pdf.worker.mjs`;


// Helper to convert a data URL string to a File object
export const dataURLtoFile = (dataurl: string, filename: string): File => {
    const arr = dataurl.split(',');
    if (arr.length < 2) throw new Error("Invalid data URL");
    const mimeMatch = arr[0].match(/:(.*?);/);
    if (!mimeMatch || !mimeMatch[1]) throw new Error("Could not parse MIME type from data URL");

    const mime = mimeMatch[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, {type:mime});
}

interface ChatMessage {
  id: number;
  sender: 'bot' | 'user';
  text: string;
  options?: string[];
}

type AppStage = 'UPLOAD' | 'ANALYSIS' | 'BOUNDARY_REVIEW' | 'BOUNDARY_EDIT' | 'PRE_GENERATION_QUERY' | 'ACCESS_POINTS' | 'PLAN_OPTIONS' | 'PLAN_REFINEMENT' | 'PLAN_EDIT' | 'PLAN_ANALYSIS';

interface SiteAnalysisChatProps {
    messages: ChatMessage[];
    onOptionSelect: (option: string, question: 'purpose' | 'priority') => void;
    showForm: boolean;
    datapoints: SiteDatapoints | null;
    onDatapointsChange: (data: SiteDatapoints) => void;
    onGenerate: () => void;
    isBotThinking: boolean;
    isSummaryLoading: boolean;
}

const SiteAnalysisChat: React.FC<SiteAnalysisChatProps> = ({ messages, onOptionSelect, showForm, datapoints, onDatapointsChange, onGenerate, isBotThinking, isSummaryLoading }) => {
    const chatContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages, showForm, isBotThinking]);
    
    const lastMessage = messages[messages.length - 1];

    if (isSummaryLoading) {
        return (
            <div className="flex flex-col h-full items-center justify-center text-center gap-4 animate-fade-in">
                <Spinner />
                <p className="text-gray-400">Analyzing site survey...</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full">
            <div ref={chatContainerRef} className="flex-grow overflow-y-auto pr-2 space-y-4">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex items-start gap-3 animate-fade-in ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                         {msg.sender === 'bot' && <div className="w-8 h-8 flex-shrink-0 bg-blue-500/20 rounded-full flex items-center justify-center"><RobotIcon className="w-5 h-5 text-blue-300" /></div>}
                        <div className={`rounded-lg px-4 py-3 max-w-sm ${msg.sender === 'bot' ? 'bg-gray-700/50 text-gray-200' : 'bg-blue-600 text-white'}`}>
                            {msg.sender === 'bot' ? (
                                <div className="prose prose-chat max-w-none">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {msg.text}
                                    </ReactMarkdown>
                                </div>
                            ) : (
                                <p className="text-base whitespace-pre-wrap">{msg.text}</p>
                            )}
                        </div>
                    </div>
                ))}
                 {isBotThinking && (
                  <div className="flex items-start gap-3 animate-fade-in">
                     <div className="w-8 h-8 flex-shrink-0 bg-blue-500/20 rounded-full flex items-center justify-center"><RobotIcon className="w-5 h-5 text-blue-300" /></div>
                     <div className="rounded-lg px-4 py-3 bg-gray-700/50 flex items-center justify-center">
                        <Spinner className="h-5 w-5 text-gray-300" />
                     </div>
                  </div>
                )}
            </div>
            <div className="pt-4 mt-auto">
                {lastMessage?.options && !isBotThinking && (
                    <div className="flex flex-wrap gap-2 animate-fade-in">
                        {lastMessage.options.map(option => (
                             <button key={option} onClick={() => onOptionSelect(option, messages.length === 1 ? 'purpose' : 'priority')} className="flex-1 bg-white/10 text-gray-200 font-semibold py-2 px-4 rounded-md transition-colors hover:bg-white/20 active:scale-95 text-sm">
                                {option}
                             </button>
                        ))}
                    </div>
                )}
                 {showForm && datapoints && (
                    <div className="animate-fade-in space-y-4">
                        <DatapointsForm 
                            initialData={datapoints}
                            onDataChange={onDatapointsChange}
                        />
                        <button
                            onClick={onGenerate}
                            className="w-full bg-gradient-to-br from-blue-600 to-blue-500 text-white font-bold py-4 px-6 rounded-lg transition-all duration-300 ease-in-out shadow-lg shadow-blue-500/20 hover:shadow-xl hover:shadow-blue-500/40 hover:-translate-y-px active:scale-95 active:shadow-inner text-base flex items-center justify-center gap-2"
                        >
                            <MagicWandIcon className="w-5 h-5" />
                            Detect Site Boundary
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

interface LoadingState {
  title: string;
  messages: string[];
}

const SAVE_STATE_KEY = 'smartLandPlannerState';

const INITIAL_BOUNDARY_SUGGESTIONS = [
    "Extend the boundary to the property line shown on the survey.",
    "The boundary is incorrect on the west side; it should follow the creek.",
    "Remove the small section that is outside the main property."
];

const INITIAL_PLAN_SUGGESTIONS = [
    "Consolidate the green space into a central community park with a playground.",
    "Reconfigure the lots on the west side to be deeper and less wide.",
    "Add a cul-de-sac at the end of the top-most road to improve safety."
];


const App: React.FC = () => {
  const [appStage, setAppStage] = useState<AppStage>('UPLOAD');
  const [surveyPdf, setSurveyPdf] = useState<File | null>(null);
  const [surveyImageUrl, setSurveyImageUrl] = useState<string | null>(null);
  const [boundaryImageUrl, setBoundaryImageUrl] = useState<string | null>(null);
  const [accessPointsImageUrl, setAccessPointsImageUrl] = useState<string | null>(null);
  const [sitePlanImageUrl, setSitePlanImageUrl] = useState<string | null>(null);
  const [planOptions, setPlanOptions] = useState<Record<string, { url: string | null; description: string }>>({});
  const [isGeneratingPlans, setIsGeneratingPlans] = useState<boolean>(false);
  const [planAnalysis, setPlanAnalysis] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingState, setLoadingState] = useState<LoadingState | null>(null);
  const [currentLoadingMessage, setCurrentLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [projectPurpose, setProjectPurpose] = useState<string | null>(null);
  const [designPriority, setDesignPriority] = useState<string | null>(null);
  const [aiRecommendations, setAiRecommendations] = useState<string | null>(null);
  const [datapoints, setDatapoints] = useState<SiteDatapoints | null>(null);
  const [surveySummary, setSurveySummary] = useState<string | null>(null);
  const [isBotThinking, setIsBotThinking] = useState<boolean>(false);
  const [isSummaryLoading, setIsSummaryLoading] = useState<boolean>(false);
  
  // Suggestion State
  const [boundarySuggestions, setBoundarySuggestions] = useState<string[]>(INITIAL_BOUNDARY_SUGGESTIONS);
  const [isFetchingBoundarySuggestions, setIsFetchingBoundarySuggestions] = useState<boolean>(false);
  const [planSuggestions, setPlanSuggestions] = useState<string[]>(INITIAL_PLAN_SUGGESTIONS);
  const [isFetchingPlanSuggestions, setIsFetchingPlanSuggestions] = useState<boolean>(false);

  // State for session persistence
  const [isStateLoaded, setIsStateLoaded] = useState(false);


  // Load state from localStorage on initial mount
  useEffect(() => {
    try {
        const savedStateJSON = localStorage.getItem(SAVE_STATE_KEY);
        if (savedStateJSON) {
            const savedState = JSON.parse(savedStateJSON);
            setAppStage(savedState.appStage || 'UPLOAD');
            setSurveyImageUrl(savedState.surveyImageUrl || null);
            setBoundaryImageUrl(savedState.boundaryImageUrl || null);
            setAccessPointsImageUrl(savedState.accessPointsImageUrl || null);
            setSitePlanImageUrl(savedState.sitePlanImageUrl || null);
            setPlanOptions(savedState.planOptions || {});
            setPlanAnalysis(savedState.planAnalysis || null);
            setMessages(savedState.messages || []);
            setProjectPurpose(savedState.projectPurpose || null);
            setDesignPriority(savedState.designPriority || null);
            setAiRecommendations(savedState.aiRecommendations || null);
            setDatapoints(savedState.datapoints || null);
            setSurveySummary(savedState.surveySummary || null);
        }
    } catch (error) {
        console.error("Failed to load app state from localStorage", error);
        localStorage.removeItem(SAVE_STATE_KEY); // Clear corrupted state
    } finally {
        setIsStateLoaded(true);
    }
  }, []);

  // Save state to localStorage whenever it changes
  useEffect(() => {
    if (!isStateLoaded) {
        return; // Don't save until the initial state is loaded
    }
    
    if (appStage === 'UPLOAD' && !surveyImageUrl) {
        localStorage.removeItem(SAVE_STATE_KEY);
        return;
    }

    const stateToSave = {
        appStage,
        surveyImageUrl,
        boundaryImageUrl,
        accessPointsImageUrl,
        sitePlanImageUrl,
        planOptions,
        planAnalysis,
        messages,
        projectPurpose,
        designPriority,
        aiRecommendations,
        datapoints,
        surveySummary,
    };

    try {
        localStorage.setItem(SAVE_STATE_KEY, JSON.stringify(stateToSave));
    } catch (error) {
        console.error("Failed to save app state to localStorage", error);
    }
  }, [
      isStateLoaded, appStage, surveyImageUrl, boundaryImageUrl, accessPointsImageUrl,
      sitePlanImageUrl, planOptions, planAnalysis, messages, projectPurpose,
      designPriority, aiRecommendations, datapoints, surveySummary
  ]);

  const handleUploadNew = useCallback(() => {
    // Reset all data state
    setSurveyPdf(null);
    setSurveyImageUrl(null);
    setBoundaryImageUrl(null);
    setAccessPointsImageUrl(null);
    setSitePlanImageUrl(null);
    setPlanOptions({});
    setPlanAnalysis(null);
    setDatapoints(null);
    setSurveySummary(null);

    // Reset all chat/interaction state
    setMessages([]);
    setProjectPurpose(null);
    setDesignPriority(null);
    setAiRecommendations(null);
    
    // Reset all loading and error states for a clean start
    setError(null);
    setIsLoading(false);
    setLoadingState(null);
    setIsGeneratingPlans(false);
    setIsBotThinking(false);
    setIsSummaryLoading(false);

    // Go back to the initial stage
    setAppStage('UPLOAD');
  }, []);

  const handleBack = useCallback(() => {
    switch(appStage) {
        case 'ANALYSIS':
            handleUploadNew(); // This resets to UPLOAD
            break;
        case 'BOUNDARY_REVIEW':
            setAppStage('ANALYSIS');
            break;
        case 'BOUNDARY_EDIT':
            setAppStage('BOUNDARY_REVIEW');
            break;
        case 'PRE_GENERATION_QUERY':
            setAppStage('BOUNDARY_REVIEW');
            break;
        case 'ACCESS_POINTS':
            setAppStage('PRE_GENERATION_QUERY');
            break;
        case 'PLAN_OPTIONS':
            setAppStage('PRE_GENERATION_QUERY');
            break;
        case 'PLAN_EDIT':
            setAppStage('PLAN_REFINEMENT');
            break;
        case 'PLAN_REFINEMENT':
            setSitePlanImageUrl(null);
            setPlanAnalysis(null);
            setAppStage('PLAN_OPTIONS');
            break;
        case 'PLAN_ANALYSIS':
            setAppStage('PLAN_REFINEMENT');
            break;
        default:
            // No action for UPLOAD
            break;
    }
  }, [appStage, handleUploadNew]);

  // Effect to fetch the survey summary when entering the ANALYSIS stage
  useEffect(() => {
    const fetchSummary = async () => {
        // Only run if we are in ANALYSIS stage, have an image, but no summary yet.
        if (appStage === 'ANALYSIS' && surveyImageUrl && !surveySummary && isStateLoaded) {
            setIsSummaryLoading(true);
            setError(null);
            try {
                const surveyImageFile = dataURLtoFile(surveyImageUrl, 'survey.png');
                const summary = await getSurveySummary(surveyImageFile);
                setSurveySummary(summary);
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
                setError(`Failed to get survey summary. ${errorMessage}`);
                console.error(err);
            } finally {
                setIsSummaryLoading(false);
            }
        }
    };
    fetchSummary();
  }, [appStage, surveyImageUrl, surveySummary, isStateLoaded]);

  useEffect(() => {
    // Start chat when summary is ready and chat hasn't started
    if (surveySummary && messages.length === 0 && appStage === 'ANALYSIS') {
      const initialSummaryMessage: ChatMessage = {
        id: 1,
        sender: 'bot',
        text: `${surveySummary}\n\nNow, to create the perfect site plan, I need to understand your project. First, could you tell me the purpose of this development?`,
        options: ["Commercial", "Industrial", "Residential"],
      };
      setTimeout(() => setMessages([initialSummaryMessage]), 500); // Small delay for effect
    }
  }, [surveySummary, messages, appStage]);
  
  useEffect(() => {
    if (loadingState && loadingState.messages.length > 0) {
      let messageIndex = 0;
      setCurrentLoadingMessage(loadingState.messages[0]);
      const interval = setInterval(() => {
        messageIndex = (messageIndex + 1) % loadingState.messages.length;
        setCurrentLoadingMessage(loadingState.messages[messageIndex]);
      }, 2500); // Change message every 2.5 seconds

      return () => clearInterval(interval);
    }
  }, [loadingState]);


  const processUploadedPdf = async (file: File) => {
      setIsLoading(true);
      setError(null);
      setLoadingState({
        title: "Processing Your Survey",
        messages: ["Reading the file...", "Converting to high-resolution image...", "Preparing the workspace..."]
      });
      try {
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
          const page = await pdf.getPage(1); // Get the first page

          // Convert PDF to PNG
          // Dynamically calculate scale to cap the longest dimension and use JPEG
          // to prevent overly large images from exceeding localStorage quota.
          const baseViewport = page.getViewport({ scale: 1.0 });
          const MAX_DIMENSION = 1024; // Reduced from 1200
          const scale = Math.min(MAX_DIMENSION / baseViewport.width, MAX_DIMENSION / baseViewport.height);
          const viewport = page.getViewport({ scale });
          console.log(`Rendering PDF page at scale ${scale.toFixed(2)} to dimensions ${Math.round(viewport.width)}x${Math.round(viewport.height)}`);
          
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Could not create canvas context.');

          await page.render({ canvas, canvasContext: context, viewport: viewport }).promise;
          const dataUrl = canvas.toDataURL('image/jpeg', 0.9); // Switched to JPEG
          setSurveyImageUrl(dataUrl);
          
          setAppStage('ANALYSIS');

      } catch (err) {
          console.error("PDF Processing Error:", err);
          const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred during PDF processing.';
          setError(`Failed to process PDF. ${errorMessage}`);
          setSurveyPdf(null);
          setAppStage('UPLOAD');
      } finally {
          setIsLoading(false);
          setLoadingState(null);
      }
  };

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (files && files[0]) {
      const file = files[0];
      if (file.type !== 'application/pdf') {
          setError('Invalid file type. Please upload a PDF file.');
          return;
      }
      handleUploadNew(); // Reset everything
      setSurveyPdf(file);
      processUploadedPdf(file);
    }
  }, [handleUploadNew]);

  const parseDatapoints = (text: string): SiteDatapoints => {
    const defaults: SiteDatapoints = {
        maxBuildableCoverage: 50,
        minGreenCoverage: 20,
        minOpenSpace: 15,
        minLotSize: 5000,
        minLotWidth: 50,
        frontSetback: 20,
        rearSetback: 20,
        sideSetback: 10,
        roadWidth: 24,
        sidewalkWidth: 5,
    };

    const extractValue = (regex: RegExp): number | null => {
        const match = text.match(regex);
        return match && match[1] ? parseFloat(match[1]) : null;
    };

    return {
        maxBuildableCoverage: extractValue(/Maximum buildable coverage \(%\)[\s:]*(\d+\.?\d*)/i) ?? defaults.maxBuildableCoverage,
        minGreenCoverage: extractValue(/Minimum green coverage \(%\)[\s:]*(\d+\.?\d*)/i) ?? defaults.minGreenCoverage,
        minOpenSpace: extractValue(/Minimum open space \(%\)[\s:]*(\d+\.?\d*)/i) ?? defaults.minOpenSpace,
        minLotSize: extractValue(/Minimum lot size \(sq ft\)[\s:]*(\d+\.?\d*)/i) ?? defaults.minLotSize,
        minLotWidth: extractValue(/Minimum lot width \(ft\)[\s:]*(\d+\.?\d*)/i) ?? defaults.minLotWidth,
        frontSetback: extractValue(/Front \(ft\)[\s:]*(\d+\.?\d*)/i) ?? defaults.frontSetback,
        rearSetback: extractValue(/Rear \(ft\)[\s:]*(\d+\.?\d*)/i) ?? defaults.rearSetback,
        sideSetback: extractValue(/Side \(ft\)[\s:]*(\d+\.?\d*)/i) ?? defaults.sideSetback,
        roadWidth: extractValue(/Road width \(ft\)[\s:]*(\d+\.?\d*)/i) ?? defaults.roadWidth,
        sidewalkWidth: extractValue(/Sidewalk width \(ft\)[\s:]*(\d+\.?\d*)/i) ?? defaults.sidewalkWidth,
    };
  };

  const handleOptionSelect = useCallback((option: string, question: 'purpose' | 'priority') => {
      const userMessage: ChatMessage = { id: Date.now(), sender: 'user', text: option };
      
      const messagesForApi = [...messages];
      if (messagesForApi.length > 0) {
        messagesForApi[messagesForApi.length - 1].options = undefined;
      }
      messagesForApi.push(userMessage);
      setMessages(messagesForApi);

      setTimeout(async () => {
        if (question === 'purpose') {
            setProjectPurpose(option);
            const nextBotMessage: ChatMessage = {
                id: Date.now() + 1,
                sender: 'bot',
                text: "Great. Now, let's think about your priorities for the design. What is the main goal you want to achieve with the layout?",
                options: ["Maximize Lot Yield", "Minimize Road Length", "Balanced Layout"],
            };
             setMessages(prev => [...prev, nextBotMessage]);
        } else {
            setDesignPriority(option);
            const thinkingMessage: ChatMessage = { id: Date.now() + 1, sender: 'bot', text: "Excellent! I'm analyzing the survey to recommend optimal parameters for you..." };
            setMessages(prev => [...prev, thinkingMessage]);
            setIsBotThinking(true);
            
            try {
                const surveyImageFile = dataURLtoFile(surveyImageUrl!, 'survey.png');
                const recommendationsResponse = await getSitePlanDatapoints(messagesForApi, surveyImageFile);
                
                const dataPointsMarker = "- Coverage Constraints:";
                const markerIndex = recommendationsResponse.indexOf(dataPointsMarker);

                let reasoning = "Based on my analysis, here are the recommended parameters for your project. You can adjust them below before we proceed."; // Fallback
                let dataPointsString = recommendationsResponse;

                if (markerIndex !== -1) {
                    reasoning = recommendationsResponse.substring(0, markerIndex).trim();
                    dataPointsString = recommendationsResponse.substring(markerIndex);
                }

                const parsedData = parseDatapoints(dataPointsString);
                setDatapoints(parsedData);
                setAiRecommendations(dataPointsString);
                
                const recommendationsMessage: ChatMessage = {
                  id: Date.now() + 2,
                  sender: 'bot',
                  text: `${reasoning}\n\nI've populated the form below with specific values based on this analysis. Feel free to adjust them before we detect the site boundary.`
                };
                setMessages(prev => [...prev.slice(0, -1), recommendationsMessage]);

            } catch(err) {
                 const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
                 setError(`Failed to get recommendations. ${errorMessage}`);
                 console.error(err);
                 // remove the "thinking" message on error
                 setMessages(prev => prev.filter(m => m.id !== thinkingMessage.id));
            } finally {
                setIsBotThinking(false);
            }
        }
      }, 800);
    }, [messages, surveyImageUrl]);

  const handleStartBoundaryDetection = useCallback(async () => {
    if (!surveyImageUrl) {
      setError('Survey image is not available.');
      return;
    }
    setIsLoading(true);
    setError(null);
    setLoadingState({
        title: "Detecting Site Boundary",
        messages: ["AI is scanning the survey...", "Identifying property lines...", "Tracing the perimeter...", "Generating boundary overlay..."]
    });
    try {
        const surveyImageFile = dataURLtoFile(surveyImageUrl, 'survey.png');
        const boundaryUrl = await detectSiteBoundary(surveyImageFile);
        setBoundaryImageUrl(boundaryUrl);
        setAppStage('BOUNDARY_REVIEW');
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to detect site boundary. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsLoading(false);
        setLoadingState(null);
    }
  }, [surveyImageUrl]);

  const handleRefineBoundary = useCallback(async (maskFile: File, query: string): Promise<void> => {
    if (!surveyImageUrl || !boundaryImageUrl) {
        setError('Cannot refine boundary without a survey image and an existing boundary.');
        return;
    }
    // No full-screen loader, the editor will show its own
    setError(null);
    try {
        const surveyImageFile = dataURLtoFile(surveyImageUrl, 'survey.png');
        const boundaryImageFile = dataURLtoFile(boundaryImageUrl, 'boundary.png');
        const refinedBoundaryUrl = await refineSiteBoundary(surveyImageFile, boundaryImageFile, maskFile, query);
        setBoundaryImageUrl(refinedBoundaryUrl);
        setAppStage('BOUNDARY_REVIEW');
        
        // Fetch new suggestions for the next time the user edits
        setIsFetchingBoundarySuggestions(true);
        try {
            const newSuggestions = await getBoundaryRefinementSuggestions(messages, surveyImageFile);
            setBoundarySuggestions(newSuggestions);
        } catch (err) {
            console.error("Failed to fetch new boundary suggestions:", err);
            setBoundarySuggestions(INITIAL_BOUNDARY_SUGGESTIONS); // Revert on failure
        } finally {
            setIsFetchingBoundarySuggestions(false);
        }

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to refine boundary. ${errorMessage}`);
        console.error(err);
        // Re-throw the error so the editor knows the operation failed
        throw err;
    }
  }, [surveyImageUrl, boundaryImageUrl, messages]);

  const handleGeneratePlanOptions = useCallback(async (accessPointsFile: File | null) => {
    if (!surveyImageUrl || !boundaryImageUrl || !projectPurpose || !designPriority || !datapoints) {
      setError('Required information is missing. Please complete all steps.');
      return;
    }
    setError(null);
    setAppStage('PLAN_OPTIONS');
    setIsGeneratingPlans(true);
    
    const networkTypes = [
        { name: 'Grid', description: 'A classic criss-cross pattern, efficient and easy to navigate.' },
        { name: 'Radial', description: 'Roads spread out from a central point, often creating a focal point.' },
        { name: 'Circular', description: 'Features roads that form loops or circles, good for traffic calming.' },
        { name: 'Hierarchical', description: 'A mix of major arterial roads and smaller local streets for efficient traffic flow.' },
        { name: 'Organic', description: 'A flowing, curvilinear layout that follows natural contours, creating a scenic feel.' },
        { name: 'Cul-de-sac', description: 'Prioritizes dead-end streets to maximize privacy and safety by eliminating through-traffic.' },
    ];
    
    const placeholders = Object.fromEntries(networkTypes.map(nt => [nt.name, { url: null, description: nt.description }]));
    setPlanOptions(placeholders);
    
    try {
        const surveyImageFile = dataURLtoFile(surveyImageUrl, 'survey.png');
        const boundaryImageFile = dataURLtoFile(boundaryImageUrl, 'boundary.png');
        
        // Calculate site area and max lots for accuracy
        console.log("Calculating site area for lot estimation...");
        const { area, unit } = await getSiteArea(surveyImageFile, boundaryImageFile);
        console.log(`Site area detected: ${area} ${unit}`);

        let totalAreaSqFt = area;
        if (unit === 'acre') {
            totalAreaSqFt = area * 43560;
        } else if (unit === 'hectare') {
            totalAreaSqFt = area * 107639;
        }
        console.log(`Total area in sq ft: ${totalAreaSqFt.toFixed(0)}`);

        const maxLotsFromBuildable = (datapoints.maxBuildableCoverage / 100) * totalAreaSqFt / datapoints.minLotSize;
        const maxLotsFromOpenSpace = totalAreaSqFt * (1 - (datapoints.minGreenCoverage / 100) - (datapoints.minOpenSpace / 100)) / datapoints.minLotSize;

        const maxLots = Math.floor(Math.min(maxLotsFromBuildable, maxLotsFromOpenSpace));
        // Set a reasonable minimum, e.g., 70% of the max, but at least 1.
        const minLots = Math.max(1, Math.floor(maxLots * 0.7)); 

        const lotCountRange = { min: minLots, max: maxLots };
        console.log(`Calculated lot count range for generation: ${minLots} - ${maxLots}`);
        
        for (const type of networkTypes) {
            try {
                const url = await generateSitePlan(surveyImageFile, boundaryImageFile, accessPointsFile, projectPurpose!, designPriority!, datapoints, type.name, lotCountRange);
                setPlanOptions(prev => ({
                    ...prev,
                    [type.name]: { ...prev[type.name], url }
                }));
            } catch (err) {
                console.error(`Failed to generate ${type.name} plan:`, err);
                // Optionally update UI to show an error state for this card
            }
        }

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to generate the site plan options. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsGeneratingPlans(false);
    }
  }, [surveyImageUrl, boundaryImageUrl, projectPurpose, designPriority, datapoints]);

  const handleConfirmAccessPoints = useCallback((accessPointsFile: File) => {
    // Convert file to dataURL to save for session persistence
    const reader = new FileReader();
    reader.readAsDataURL(accessPointsFile);
    reader.onloadend = () => {
        setAccessPointsImageUrl(reader.result as string);
    };
    // Pass the file directly to the generation function
    handleGeneratePlanOptions(accessPointsFile);
  }, [handleGeneratePlanOptions]);

  const handleSelectPlanOption = useCallback((imageUrl: string) => {
    setSitePlanImageUrl(imageUrl);
    setPlanSuggestions(INITIAL_PLAN_SUGGESTIONS); // Reset to initial suggestions for the new plan
    setAppStage('PLAN_REFINEMENT');
  }, []);

  const handleRefineSitePlan = useCallback(async (query: string, datapointsFromForm: SiteDatapoints) => {
    if (!sitePlanImageUrl || !surveyImageUrl || !projectPurpose || !designPriority) {
        setError('Cannot refine plan without an active plan and project goals.');
        return;
    }
    setIsLoading(true);
    setLoadingState({
        title: "Refining Your Plan",
        messages: ["AI is analyzing your request...", "Updating site parameters...", "Recalculating lot arrangements...", "Rendering the updated plan..."]
    });
    setError(null);
    try {
        // Step 1: Get updated datapoints from the query
        const newDatapoints = await updateDatapointsFromQuery(query, datapointsFromForm);
        setDatapoints(newDatapoints); // This will update the form

        // Step 2: Refine the visual plan with the query and new datapoints
        const planFile = dataURLtoFile(sitePlanImageUrl, 'plan.png');
        const surveyFile = dataURLtoFile(surveyImageUrl, 'survey.png');
        let accessPointsFile: File | null = null;
        if (accessPointsImageUrl) {
            accessPointsFile = dataURLtoFile(accessPointsImageUrl, 'access-points.png');
        }
        const refinedUrl = await refineSitePlan(planFile, surveyFile, query, newDatapoints, accessPointsFile, null);
        setSitePlanImageUrl(refinedUrl);

        // Step 3: Fetch new suggestions based on the refined plan
        setIsFetchingPlanSuggestions(true);
        try {
            const newSuggestions = await getPlanRefinementSuggestions(messages, planFile);
            setPlanSuggestions(newSuggestions);
        } catch (err) {
            console.error("Failed to fetch new plan suggestions:", err);
            setPlanSuggestions(INITIAL_PLAN_SUGGESTIONS); // Revert on failure
        } finally {
            setIsFetchingPlanSuggestions(false);
        }

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to refine site plan. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsLoading(false);
        setLoadingState(null);
    }
  }, [sitePlanImageUrl, surveyImageUrl, accessPointsImageUrl, projectPurpose, designPriority, messages]);

  const handleVisualRefineSitePlan = useCallback(async (maskFile: File, query: string): Promise<void> => {
    if (!sitePlanImageUrl || !surveyImageUrl || !datapoints) {
        setError('Required information is missing for visual refinement.');
        return;
    }
    // No full-screen loader, editor will show its own
    setError(null);
    try {
        const planFile = dataURLtoFile(sitePlanImageUrl, 'plan.png');
        const surveyFile = dataURLtoFile(surveyImageUrl, 'survey.png');
        let accessPointsFile: File | null = null;
        if (accessPointsImageUrl) {
            accessPointsFile = dataURLtoFile(accessPointsImageUrl, 'access-points.png');
        }

        // Call the updated refineSitePlan function with the mask
        const refinedUrl = await refineSitePlan(planFile, surveyFile, query, datapoints, accessPointsFile, maskFile);
        setSitePlanImageUrl(refinedUrl);
        setAppStage('PLAN_REFINEMENT'); // Go back to refinement view

        // Optional: Fetch new suggestions after visual edit. Let's do it for consistency.
        setIsFetchingPlanSuggestions(true);
        try {
            const newSuggestions = await getPlanRefinementSuggestions(messages, dataURLtoFile(refinedUrl, 'plan.png'));
            setPlanSuggestions(newSuggestions);
        } catch (err) {
            console.error("Failed to fetch new plan suggestions after visual edit:", err);
            setPlanSuggestions(INITIAL_PLAN_SUGGESTIONS); // Revert on failure
        } finally {
            setIsFetchingPlanSuggestions(false);
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to refine plan visually. ${errorMessage}`);
        console.error(err);
        throw err; // Re-throw for editor to handle
    }
  }, [sitePlanImageUrl, surveyImageUrl, accessPointsImageUrl, datapoints, messages]);

  const handleAnalyzeSitePlan = useCallback(async () => {
    if (!sitePlanImageUrl || !datapoints) {
        setError('Generated plan or datapoints not available for analysis.');
        return;
    }
    setIsLoading(true); // Keep PlanRefiner buttons disabled
    setError(null);
    setPlanAnalysis(''); // Reset for streaming
    setAppStage('PLAN_ANALYSIS');

    try {
        const sitePlanFile = dataURLtoFile(sitePlanImageUrl, 'site-plan.png');
        const analysisStream = analyzeSitePlan(sitePlanFile, datapoints);
        for await (const chunk of analysisStream) {
            setPlanAnalysis(prev => prev + chunk);
        }
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to analyze the site plan. ${errorMessage}`);
        console.error(err);
        setAppStage('PLAN_REFINEMENT'); // Go back on error
    } finally {
        setIsLoading(false); // Re-enable PlanRefiner buttons
    }
  }, [sitePlanImageUrl, datapoints]);

  const handleDownload = (imageUrl: string, filename: string) => {
      if (imageUrl) {
          const link = document.createElement('a');
          link.href = imageUrl;
          link.download = filename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
      }
  };
  
  const renderContent = () => {
    if (error) {
       return (
           <div className="text-center animate-fade-in bg-red-500/10 border border-red-500/20 p-8 rounded-lg max-w-2xl mx-auto flex flex-col items-center gap-4">
            <h2 className="text-2xl font-bold text-red-300">An Error Occurred</h2>
            <p className="text-md text-red-400">{error}</p>
            <button
                onClick={() => { setError(null); handleUploadNew(); }}
                className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-lg text-md transition-colors"
              >
                Start Over
            </button>
          </div>
        );
    }
    
    if (appStage === 'UPLOAD') {
      return <StartScreen onFileSelect={handleFileSelect} />;
    }
    
    if (isLoading && loadingState && !surveyImageUrl && appStage !== 'PLAN_OPTIONS') {
        return (
            <div className="flex flex-col items-center justify-center gap-6 text-center animate-fade-in">
                <Spinner className="h-16 w-16 text-gray-200 mx-auto" />
                <h2 className="text-2xl font-bold text-gray-200">{loadingState.title}</h2>
                <p className="text-gray-400 max-w-sm">{currentLoadingMessage}</p>
            </div>
        );
    }

    if (appStage === 'BOUNDARY_EDIT' && surveyImageUrl && boundaryImageUrl) {
        return (
             <BoundaryEditor
                surveyImageUrl={surveyImageUrl}
                boundaryImageUrl={boundaryImageUrl}
                onRefine={handleRefineBoundary}
                onBack={handleBack}
                suggestions={boundarySuggestions}
                isSuggestionsLoading={isFetchingBoundarySuggestions}
             />
        );
    }

    if (appStage === 'ACCESS_POINTS' && surveyImageUrl && boundaryImageUrl) {
      return (
          <AccessPointEditor
              surveyImageUrl={surveyImageUrl}
              boundaryImageUrl={boundaryImageUrl}
              onConfirm={handleConfirmAccessPoints}
              onBack={handleBack}
              isLoading={isLoading}
          />
      );
    }

    if (appStage === 'PLAN_OPTIONS') {
        return <PlanOptions 
            options={planOptions} 
            onSelect={handleSelectPlanOption}
            isLoading={isGeneratingPlans}
            onBack={handleBack}
        />;
    }

    if (appStage === 'PLAN_EDIT' && sitePlanImageUrl) {
        return (
            <SitePlanEditor
                sitePlanImageUrl={sitePlanImageUrl}
                onRefine={handleVisualRefineSitePlan}
                onBack={handleBack}
            />
        );
    }

    return (
        <div className="w-full max-w-7xl mx-auto animate-fade-in">
            {isLoading && loadingState && (
                 <div className="fixed inset-0 bg-black/70 z-50 flex flex-col items-center justify-center gap-6 text-center animate-fade-in backdrop-blur-sm">
                    <Spinner className="h-16 w-16 text-gray-200" />
                    <h2 className="text-3xl font-bold text-gray-200">{loadingState.title}</h2>
                    <p className="text-lg text-gray-400 max-w-md">{currentLoadingMessage}</p>
                </div>
            )}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col gap-4 backdrop-blur-sm">
                    <h2 className="text-xl font-bold text-center text-gray-200">
                        {appStage === 'PLAN_REFINEMENT' || appStage === 'PLAN_ANALYSIS' ? 'Site Plan' : 'Site Survey'}
                    </h2>
                    {appStage === 'PLAN_REFINEMENT' || appStage === 'PLAN_ANALYSIS' ? (
                        sitePlanImageUrl ? (
                            <img src={sitePlanImageUrl} alt="Generated Site Plan" className="rounded-md w-full object-contain flex-grow" />
                        ) : <div className="flex-grow flex items-center justify-center text-gray-500">Plan not available</div>
                    ) : (
                        surveyImageUrl && (
                        <div className="relative">
                            <img src={surveyImageUrl} alt="Site Survey" className="rounded-md w-full object-contain" />
                            {boundaryImageUrl && (
                                <img 
                                    src={boundaryImageUrl} 
                                    alt="Detected Site Boundary" 
                                    className="absolute top-0 left-0 w-full h-full object-contain pointer-events-none animate-fade-in" 
                                />
                            )}
                        </div>
                        )
                    )}
                    <div className="flex gap-2 mt-auto pt-4">
                        <button
                          onClick={handleUploadNew}
                          className="flex-1 flex items-center justify-center gap-2 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20"
                        >
                          <UploadIcon className="w-5 h-5" />
                          Upload New PDF
                        </button>
                         <button
                          onClick={() => handleDownload(
                            (appStage === 'PLAN_REFINEMENT' || appStage === 'PLAN_ANALYSIS') ? sitePlanImageUrl! : surveyImageUrl!,
                            (appStage === 'PLAN_REFINEMENT' || appStage === 'PLAN_ANALYSIS') ? 'site-plan.png' : 'site-survey.png'
                          )}
                          disabled={!( (appStage === 'PLAN_REFINEMENT' || appStage === 'PLAN_ANALYSIS') ? sitePlanImageUrl : surveyImageUrl)}
                          className="flex-1 bg-green-600 text-white font-semibold py-3 px-4 rounded-md transition-colors hover:bg-green-500 disabled:bg-gray-500 disabled:cursor-not-allowed"
                        >
                          Download {(appStage === 'PLAN_REFINEMENT' || appStage === 'PLAN_ANALYSIS') ? 'Plan' : 'PNG'}
                        </button>
                    </div>
                </div>

                <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-4 flex flex-col gap-4 backdrop-blur-sm min-h-[500px]">
                    {appStage === 'ANALYSIS' && (
                        <>
                         <h2 className="text-xl font-bold text-center text-gray-200">Site Survey Analysis</h2>
                          <SiteAnalysisChat 
                              messages={messages}
                              onOptionSelect={handleOptionSelect}
                              showForm={!!aiRecommendations && !!datapoints}
                              datapoints={datapoints}
                              onDatapointsChange={setDatapoints}
                              onGenerate={handleStartBoundaryDetection}
                              isBotThinking={isBotThinking}
                              isSummaryLoading={isSummaryLoading}
                          />
                        </>
                    )}
                    {appStage === 'BOUNDARY_REVIEW' && (
                        <div className='flex flex-col h-full justify-center items-center text-center gap-6 animate-fade-in'>
                             <h2 className="text-2xl font-bold text-gray-200">Review Site Boundary</h2>
                             <p className='text-gray-400 max-w-sm'>The AI has detected the site boundary, highlighted in red. Please review it. You can confirm to proceed, refine it, or ask the AI to try again.</p>
                             <div className='flex w-full max-w-md flex-col gap-3 mt-4'>
                                <button onClick={() => setAppStage('PRE_GENERATION_QUERY')} className='w-full flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-3 px-4 rounded-md transition-colors hover:bg-green-500'>
                                    <CheckIcon className='w-5 h-5' />
                                    Confirm & Continue
                                </button>
                                <div className='flex w-full gap-3'>
                                    <button onClick={handleStartBoundaryDetection} className='flex-1 flex items-center justify-center gap-2 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20'>
                                        <MagicWandIcon className='w-5 h-5' />
                                        Retry
                                    </button>
                                    <button onClick={() => { setBoundarySuggestions(INITIAL_BOUNDARY_SUGGESTIONS); setAppStage('BOUNDARY_EDIT'); }} className='flex-1 flex items-center justify-center gap-2 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20'>
                                        <PencilIcon className='w-5 h-5' />
                                        Refine
                                    </button>
                                </div>
                             </div>
                        </div>
                    )}
                    {appStage === 'PRE_GENERATION_QUERY' && (
                         <div className='flex flex-col h-full justify-center items-center text-center gap-6 animate-fade-in'>
                             <div className="w-12 h-12 flex-shrink-0 bg-blue-500/20 rounded-full flex items-center justify-center"><RobotIcon className="w-7 h-7 text-blue-300" /></div>
                             <h2 className="text-2xl font-bold text-gray-200">One Last Question...</h2>
                             <p className='text-gray-400 max-w-sm'>Are there specific road access points for this site? Marking them will help the AI create a more accurate road network.</p>
                             <div className='flex flex-col sm:flex-row w-full max-w-sm gap-4 mt-4'>
                                <button onClick={() => handleGeneratePlanOptions(null)} className='flex-1 flex items-center justify-center gap-2 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20'>
                                    No, Generate Plans
                                </button>
                                <button onClick={() => setAppStage('ACCESS_POINTS')} className='flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white font-bold py-3 px-4 rounded-md transition-colors hover:bg-blue-500'>
                                    Yes, Mark Points
                                </button>
                             </div>
                        </div>
                    )}
                    {appStage === 'PLAN_REFINEMENT' && sitePlanImageUrl && datapoints && (
                       <PlanRefiner
                          initialDatapoints={datapoints}
                          onDatapointsChange={setDatapoints}
                          onRefine={handleRefineSitePlan}
                          onAnalyze={handleAnalyzeSitePlan}
                          onStartEdit={() => setAppStage('PLAN_EDIT')}
                          isLoading={isLoading}
                          suggestions={planSuggestions}
                          isSuggestionsLoading={isFetchingPlanSuggestions}
                       />
                    )}
                     {appStage === 'PLAN_ANALYSIS' && (
                         <div className='flex flex-col h-full gap-4'>
                             <h2 className="text-2xl font-bold text-gray-200 text-center">Site Plan Analysis</h2>
                             <div className="bg-black/20 p-4 rounded-lg border border-gray-700/50 overflow-y-auto flex-grow prose">
                                {planAnalysis ? (
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                        {planAnalysis}
                                    </ReactMarkdown>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full gap-4">
                                        <Spinner />
                                        <p className="text-gray-400">AI is analyzing the plan...</p>
                                    </div>
                                )}
                             </div>
                             <button onClick={() => setAppStage('PLAN_REFINEMENT')} className='w-full bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20 mt-auto'>
                                 Back to Refinement
                             </button>
                         </div>
                    )}
                </div>
            </div>
        </div>
    );
  };

  return (
    <div className="min-h-screen text-gray-200 bg-transparent">
      <Header onBack={handleBack} onGoHome={handleUploadNew} appStage={appStage} />
      <main className="p-4 sm:p-8 flex flex-col items-center justify-center flex-grow" style={{ minHeight: 'calc(100vh - 73px)'}}>
          {isStateLoaded && renderContent()}
      </main>
    </div>
  );
};

export default App;
