/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useState, useCallback, useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { generateSitePlan, getSitePlanDatapoints, detectSiteBoundary, refineSiteBoundary, analyzeSitePlan, refineSitePlan } from './services/geminiService';
import { SiteDatapoints } from './types';
import Header from './components/Header';
import Spinner from './components/Spinner';
import StartScreen from './components/StartScreen';
import DatapointsForm from './components/DatapointsForm';
import BoundaryEditor from './components/BoundaryEditor';
import AccessPointEditor from './components/AccessPointEditor';
import PlanOptions from './components/PlanOptions';
import PlanRefiner from './components/PlanRefiner';
import { UploadIcon, MagicWandIcon, RobotIcon, CheckIcon, PencilIcon } from './components/icons';

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

const initialBotMessage: ChatMessage = {
    id: 1,
    sender: 'bot',
    text: "I'm Genie, your site plan assistant. To create the perfect site plan for you, I need to understand your project. First, could you tell me the purpose of this site plan? For example, are you planning a new home, a commercial development, or something else?",
    options: ["Commercial", "Industrial", "Residential"],
};

type AppStage = 'UPLOAD' | 'ANALYSIS' | 'BOUNDARY_REVIEW' | 'BOUNDARY_EDIT' | 'PRE_GENERATION_QUERY' | 'ACCESS_POINTS' | 'PLAN_OPTIONS' | 'PLAN_REFINEMENT' | 'PLAN_ANALYSIS';

interface SiteAnalysisChatProps {
    messages: ChatMessage[];
    onOptionSelect: (option: string, question: 'purpose' | 'priority') => void;
    showForm: boolean;
    datapoints: SiteDatapoints | null;
    onDatapointsChange: (data: SiteDatapoints) => void;
    onGenerate: () => void;
}

const SiteAnalysisChat: React.FC<SiteAnalysisChatProps> = ({ messages, onOptionSelect, showForm, datapoints, onDatapointsChange, onGenerate }) => {
    const chatContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages, showForm]);
    
    const lastMessage = messages[messages.length - 1];

    return (
        <div className="flex flex-col h-full">
            <div ref={chatContainerRef} className="flex-grow overflow-y-auto pr-2 space-y-4">
                {messages.map((msg) => (
                    <div key={msg.id} className={`flex items-start gap-3 animate-fade-in ${msg.sender === 'user' ? 'justify-end' : ''}`}>
                         {msg.sender === 'bot' && <div className="w-8 h-8 flex-shrink-0 bg-blue-500/20 rounded-full flex items-center justify-center"><RobotIcon className="w-5 h-5 text-blue-300" /></div>}
                        <div className={`rounded-lg px-4 py-3 max-w-sm ${msg.sender === 'bot' ? 'bg-gray-700/50 text-gray-200' : 'bg-blue-600 text-white'}`}>
                            <p className="text-base whitespace-pre-wrap">{msg.text}</p>
                        </div>
                    </div>
                ))}
            </div>
            <div className="pt-4 mt-auto">
                {lastMessage?.options && (
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


const App: React.FC = () => {
  const [appStage, setAppStage] = useState<AppStage>('UPLOAD');
  const [surveyPdf, setSurveyPdf] = useState<File | null>(null);
  const [surveyImageUrl, setSurveyImageUrl] = useState<string | null>(null);
  const [boundaryImageUrl, setBoundaryImageUrl] = useState<string | null>(null);
  const [accessPointsImage, setAccessPointsImage] = useState<File | null>(null);
  const [sitePlanImageUrl, setSitePlanImageUrl] = useState<string | null>(null);
  const [planOptions, setPlanOptions] = useState<Record<string, { url: string | null; description: string }>>({});
  const [isGeneratingPlans, setIsGeneratingPlans] = useState<boolean>(false);
  const [planAnalysis, setPlanAnalysis] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingMessage, setLoadingMessage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [projectPurpose, setProjectPurpose] = useState<string | null>(null);
  const [designPriority, setDesignPriority] = useState<string | null>(null);
  const [aiRecommendations, setAiRecommendations] = useState<string | null>(null);
  const [datapoints, setDatapoints] = useState<SiteDatapoints | null>(null);

  useEffect(() => {
    // Start chat when survey image is ready and chat hasn't started
    if (surveyImageUrl && messages.length === 0 && appStage === 'ANALYSIS') {
      setTimeout(() => setMessages([initialBotMessage]), 500); // Small delay for effect
    }
  }, [surveyImageUrl, messages, appStage]);


  const processUploadedPdf = async (file: File) => {
      setIsLoading(true);
      setError(null);
      try {
          // Step 1: Convert PDF to PNG
          setLoadingMessage('Converting PDF to image...');
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
          const page = await pdf.getPage(1); // Get the first page
          const viewport = page.getViewport({ scale: 2.0 }); // Increase scale for better resolution
          
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Could not create canvas context.');

          await page.render({ canvas, canvasContext: context, viewport: viewport }).promise;
          const dataUrl = canvas.toDataURL('image/png');
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
          setLoadingMessage('');
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
  }, []);

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
      
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1].options = undefined;
        return [...updated, userMessage];
      });

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
            const thinkingMessage: ChatMessage = { id: Date.now() + 1, sender: 'bot', text: "Excellent! Analyzing the survey to recommend optimal parameters..." };
            setMessages(prev => [...prev, thinkingMessage]);
            setIsLoading(true);
            setLoadingMessage('Genie is analyzing your survey...');
            
            try {
                if (!surveyImageUrl || !projectPurpose) throw new Error("Missing survey image or project purpose.");
                const surveyImageFile = dataURLtoFile(surveyImageUrl, 'survey.png');
                const recommendationsText = await getSitePlanDatapoints(surveyImageFile, projectPurpose, option);
                
                const parsedData = parseDatapoints(recommendationsText);
                setDatapoints(parsedData);
                setAiRecommendations(recommendationsText);
                
                const recommendationsMessage: ChatMessage = {
                  id: Date.now() + 2,
                  sender: 'bot',
                  text: `Based on my analysis, here are the recommended parameters for your project. You can adjust them below before we proceed.\n\n${recommendationsText}`
                };
                setMessages(prev => [...prev.slice(0, -1), recommendationsMessage]);
            } catch(err) {
                 const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
                 setError(`Failed to get recommendations. ${errorMessage}`);
                 console.error(err);
                 setMessages(prev => prev.slice(0, -1));
            } finally {
                setIsLoading(false);
                setLoadingMessage('');
            }
        }
      }, 800);
    }, [surveyImageUrl, projectPurpose]);

  const handleStartBoundaryDetection = useCallback(async () => {
    if (!surveyImageUrl) {
      setError('Survey image is not available.');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
        const surveyImageFile = dataURLtoFile(surveyImageUrl, 'survey.png');
        setLoadingMessage('Detecting site boundary...');
        const boundaryUrl = await detectSiteBoundary(surveyImageFile);
        setBoundaryImageUrl(boundaryUrl);
        setAppStage('BOUNDARY_REVIEW');
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to detect site boundary. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  }, [surveyImageUrl]);

  const handleRefineBoundary = useCallback(async (maskFile: File, query: string) => {
    if (!surveyImageUrl) {
        setError('Cannot refine boundary without a survey image.');
        return;
    }
    setIsLoading(true);
    setLoadingMessage('AI is refining the boundary...');
    setError(null);
    try {
        const surveyImageFile = dataURLtoFile(surveyImageUrl, 'survey.png');
        const refinedBoundaryUrl = await refineSiteBoundary(surveyImageFile, maskFile, query);
        setBoundaryImageUrl(refinedBoundaryUrl);
        setAppStage('BOUNDARY_REVIEW');
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to refine boundary. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  }, [surveyImageUrl]);

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
    ];
    
    const placeholders = Object.fromEntries(networkTypes.map(nt => [nt.name, { url: null, description: nt.description }]));
    setPlanOptions(placeholders);
    
    try {
        const surveyImageFile = dataURLtoFile(surveyImageUrl, 'survey.png');
        const boundaryImageFile = dataURLtoFile(boundaryImageUrl, 'boundary.png');
        
        const promises = networkTypes.map(type => 
            generateSitePlan(surveyImageFile, boundaryImageFile, accessPointsFile, projectPurpose!, designPriority!, datapoints, type.name)
                .then(url => {
                    setPlanOptions(prev => ({
                        ...prev,
                        [type.name]: { ...prev[type.name], url }
                    }));
                })
                .catch(err => {
                    console.error(`Failed to generate ${type.name} plan:`, err);
                    // Optionally update UI to show an error state for this card
                })
        );

        await Promise.allSettled(promises);

    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to generate the site plan options. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsGeneratingPlans(false);
    }
  }, [surveyImageUrl, boundaryImageUrl, projectPurpose, designPriority, datapoints]);

  const handleConfirmAccessPoints = useCallback((accessPointsFile: File) => {
    setAccessPointsImage(accessPointsFile);
    handleGeneratePlanOptions(accessPointsFile);
  }, [handleGeneratePlanOptions]);

  const handleSelectPlanOption = useCallback((imageUrl: string) => {
    setSitePlanImageUrl(imageUrl);
    setAppStage('PLAN_REFINEMENT');
  }, []);

  const handleRefineSitePlan = useCallback(async (query: string, updatedDatapoints: SiteDatapoints) => {
    if (!sitePlanImageUrl || !surveyImageUrl) {
        setError('Cannot refine plan without an active plan and survey image.');
        return;
    }
    setIsLoading(true);
    setLoadingMessage('AI is refining your plan...');
    setError(null);
    try {
        const planFile = dataURLtoFile(sitePlanImageUrl, 'plan.png');
        const surveyFile = dataURLtoFile(surveyImageUrl, 'survey.png');
        const refinedUrl = await refineSitePlan(planFile, surveyFile, query, updatedDatapoints);
        setSitePlanImageUrl(refinedUrl);
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to refine site plan. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  }, [sitePlanImageUrl, surveyImageUrl]);

  const handleAnalyzeSitePlan = useCallback(async () => {
    if (!sitePlanImageUrl || !datapoints) {
      setError('Generated plan or datapoints not available for analysis.');
      return;
    }
    setIsLoading(true);
    setLoadingMessage('Genie is analyzing your site plan...');
    setError(null);
    try {
        const sitePlanFile = dataURLtoFile(sitePlanImageUrl, 'site-plan.png');
        const analysisResult = await analyzeSitePlan(sitePlanFile, datapoints);
        setPlanAnalysis(analysisResult);
        setAppStage('PLAN_ANALYSIS');
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
        setError(`Failed to analyze the site plan. ${errorMessage}`);
        console.error(err);
    } finally {
        setIsLoading(false);
        setLoadingMessage('');
    }
  }, [sitePlanImageUrl, datapoints]);

  const handleUploadNew = useCallback(() => {
    setSurveyPdf(null);
    setSurveyImageUrl(null);
    setBoundaryImageUrl(null);
    setAccessPointsImage(null);
    setSitePlanImageUrl(null);
    setPlanOptions({});
    setPlanAnalysis(null);
    setError(null);
    setMessages([]);
    setProjectPurpose(null);
    setDesignPriority(null);
    setAiRecommendations(null);
    setDatapoints(null);
    setAppStage('UPLOAD');
  }, []);

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
    
    if (isLoading && !surveyImageUrl && appStage !== 'PLAN_OPTIONS') {
        return (
            <div className="flex flex-col items-center justify-center gap-6 text-center animate-fade-in">
                <Spinner />
                <h2 className="text-2xl font-bold text-gray-200">{loadingMessage}</h2>
                <p className="text-gray-400">This may take a moment. Please wait...</p>
            </div>
        );
    }

    if (appStage === 'BOUNDARY_EDIT' && surveyImageUrl && boundaryImageUrl) {
        return (
             <BoundaryEditor
                surveyImageUrl={surveyImageUrl}
                boundaryImageUrl={boundaryImageUrl}
                onRefine={handleRefineBoundary}
                onCancel={() => setAppStage('BOUNDARY_REVIEW')}
                isLoading={isLoading}
             />
        );
    }

    if (appStage === 'ACCESS_POINTS' && surveyImageUrl && boundaryImageUrl) {
      return (
          <AccessPointEditor
              surveyImageUrl={surveyImageUrl}
              boundaryImageUrl={boundaryImageUrl}
              onConfirm={handleConfirmAccessPoints}
              onCancel={() => setAppStage('PRE_GENERATION_QUERY')}
              isLoading={isLoading}
          />
      );
    }

    if (appStage === 'PLAN_OPTIONS') {
        return <PlanOptions 
            options={planOptions} 
            onSelect={handleSelectPlanOption}
            isLoading={isGeneratingPlans}
        />;
    }

    return (
        <div className="w-full max-w-7xl mx-auto animate-fade-in">
            {isLoading && (
                 <div className="fixed inset-0 bg-black/70 z-50 flex flex-col items-center justify-center gap-6 text-center animate-fade-in backdrop-blur-sm">
                    <Spinner />
                    <h2 className="text-2xl font-bold text-gray-200">{loadingMessage}</h2>
                    <p className="text-gray-400">Please wait...</p>
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
                          />
                        </>
                    )}
                    {appStage === 'BOUNDARY_REVIEW' && (
                        <div className='flex flex-col h-full justify-center items-center text-center gap-6 animate-fade-in'>
                             <h2 className="text-2xl font-bold text-gray-200">Review Site Boundary</h2>
                             <p className='text-gray-400 max-w-sm'>The AI has detected the site boundary, highlighted in red. Please review it. You can confirm to proceed or refine it if needed.</p>
                             <div className='flex flex-col sm:flex-row w-full max-w-sm gap-4 mt-4'>
                                <button onClick={() => setAppStage('BOUNDARY_EDIT')} className='flex-1 flex items-center justify-center gap-2 bg-white/10 text-gray-200 font-semibold py-3 px-4 rounded-md transition-colors hover:bg-white/20'>
                                    <PencilIcon className='w-5 h-5' />
                                    Refine Boundary
                                </button>
                                <button onClick={() => setAppStage('PRE_GENERATION_QUERY')} className='flex-1 flex items-center justify-center gap-2 bg-green-600 text-white font-bold py-3 px-4 rounded-md transition-colors hover:bg-green-500'>
                                    <CheckIcon className='w-5 h-5' />
                                    Confirm & Continue
                                </button>
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
                          isLoading={isLoading}
                       />
                    )}
                     {appStage === 'PLAN_ANALYSIS' && planAnalysis && (
                         <div className='flex flex-col h-full gap-4'>
                             <h2 className="text-2xl font-bold text-gray-200 text-center">Site Plan Analysis</h2>
                             <div className="bg-black/20 p-4 rounded-lg border border-gray-700/50 overflow-y-auto flex-grow">
                                <pre className="text-gray-300 text-sm whitespace-pre-wrap font-sans">{planAnalysis}</pre>
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
      <Header />
      <main className="p-4 sm:p-8 flex flex-col items-center justify-center flex-grow" style={{ minHeight: 'calc(100vh - 73px)'}}>
          {renderContent()}
      </main>
    </div>
  );
};

export default App;