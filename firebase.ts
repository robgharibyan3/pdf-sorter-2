import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, degrees } from 'pdf-lib';
import { X, Calendar, Download, Layers, CheckSquare, Square, Trash2, Loader2, ZoomIn, ZoomOut, CheckCircle2, Scissors, GripVertical, RotateCcw, RotateCw, Trash, Undo2, Redo2, ArrowUp, Sparkles, BrainCircuit, Lightbulb } from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

interface PageState {
  rotation: number;
  isRemoved: boolean;
}

interface HistorySnapshot {
  groups: Group[];
  pageStates: Record<number, PageState>;
}

interface AIFeedback {
  layoutId: string;
  confirmedDate: string;
  confidence: number;
}

interface Group {
  id: string;
  pages: number[];
  dateInput: string;
  parsedDate: Date | null;
}

interface PdfEditorProps {
  file: File;
  onClose: () => void;
}

const GROUP_COLORS = [
  '#f59e0b', // Amber
  '#ef4444', // Red
  '#3b82f6', // Blue
  '#10b981', // Green
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#06b6d4', // Cyan
  '#f97316', // Orange
];

// Thumbnail version of the page renderer with Virtualization
const PdfThumbnail = React.memo(({ 
  pdfProxy, 
  pageNum, 
  rotation = 0 
}: { 
  pdfProxy: pdfjsLib.PDFDocumentProxy, 
  pageNum: number, 
  rotation?: number 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
      }
    }, { root: null, rootMargin: '200px' });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible || !canvasRef.current || !pdfProxy) return;
    let renderTask: any;
    let isActive = true;

    const renderThumb = async () => {
      try {
        const page = await pdfProxy.getPage(pageNum);
        if (!isActive) return;
        const viewport = page.getViewport({ scale: 0.2 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // @ts-ignore
        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
      } catch (err) {
        if ((err as Error).name !== 'RenderingCancelledException') {
          console.error("Error rendering thumb", pageNum, err);
        }
      }
    };

    renderThumb();

    return () => {
      isActive = false;
      if (renderTask) renderTask.cancel();
    };
  }, [pdfProxy, pageNum, isVisible]);

  return (
    <div ref={containerRef} style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 0.3s ease' }} className="w-full h-full flex items-center justify-center">
      <canvas 
        ref={canvasRef} 
        className="max-w-full max-h-full w-auto h-auto object-contain"
      />
    </div>
  );
});

// Single Page Renderer with Intersection Observer for Performance
const PdfPage = React.memo(({ 
  pdfProxy, 
  pageNum, 
  isSelected, 
  onToggleSelect, 
  groupLabel, 
  groupColor,
  rotation = 0,
  onRotate,
  onRemove
}: { 
  pdfProxy: pdfjsLib.PDFDocumentProxy, 
  pageNum: number, 
  isSelected: boolean, 
  onToggleSelect: (page: number, isShift: boolean) => void,
  groupLabel?: string,
  groupColor?: string,
  rotation?: number,
  onRotate: (dir: 'cw' | 'ccw') => void,
  onRemove: () => void
} & React.HTMLAttributes<HTMLDivElement>) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isRendered, setIsRendered] = useState(false);

  const isAssigned = !!groupLabel;

  useEffect(() => {
    if (!containerRef.current) return;
    const scrollRoot = document.getElementById('pdf-scroll-container');
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
      }
    }, { root: scrollRoot, rootMargin: '300px' });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible || isRendered || !canvasRef.current || !pdfProxy) return;
    let renderTask: any;
    let isActive = true;

    const renderPage = async () => {
      try {
        const page = await pdfProxy.getPage(pageNum);
        if (!isActive) return;
        const viewport = page.getViewport({ scale: 1.5 }); // High enough res for reading
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        
        // @ts-ignore
        renderTask = page.render({ canvasContext: context, viewport });
        await renderTask.promise;
        setIsRendered(true);
      } catch (err) {
        if ((err as Error).name !== 'RenderingCancelledException') {
          console.error("Error rendering page", pageNum, err);
        }
      }
    };

    renderPage();

    return () => {
      isActive = false;
      if (renderTask) renderTask.cancel();
    };
  }, [isVisible, isRendered, pdfProxy, pageNum]);

  return (
    <motion.div 
      id={`page-${pageNum}`}
      ref={containerRef}
      whileHover={{ scale: 1.02, y: -4 }}
      whileTap={{ scale: 0.98 }}
      className={`relative group rounded-xl overflow-hidden border-[4px] cursor-pointer transition-all duration-300 ${
        isSelected 
          ? 'border-[#fbfffe] shadow-[0_0_40px_rgba(251,255,254,0.4)] z-20' 
          : isAssigned 
            ? 'shadow-lg' 
            : 'border-transparent hover:border-[#fbfffe]/30 shadow-sm hover:shadow-xl bg-[#1b1b1e]'
      }`}
      onClick={(e) => onToggleSelect(pageNum, e.shiftKey)}
      style={{ 
        aspectRatio: '1/1.4', 
        backgroundColor: '#ffffff',
        borderColor: isAssigned && !isSelected ? groupColor : undefined,
        boxShadow: isAssigned && !isSelected ? `0 0 25px ${groupColor}55` : undefined,
      }}
    >
      {/* Group Tint (Subtle background highlight) */}
      {isAssigned && !isSelected && (
        <div 
          className="absolute inset-0 z-[1] opacity-[0.08] pointer-events-none" 
          style={{ backgroundColor: groupColor }}
        />
      )}

      {/* Selection Overlay */}
      <AnimatePresence>
        {isSelected && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-[#fbfffe]/20 z-10 flex items-center justify-center pointer-events-none backdrop-blur-[2px]"
          >
            <div className="bg-[#fbfffe] p-3 rounded-2xl shadow-2xl scale-125 border-4 border-[#1b1b1e]">
              <CheckSquare size={28} className="text-[#1b1b1e]" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <div className="absolute top-2 right-2 z-30 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button 
          onClick={(e) => { e.stopPropagation(); onRotate('ccw'); }}
          className="p-1.5 bg-black/60 backdrop-blur-md rounded-lg text-white hover:bg-[#faa916] transition-colors shadow-lg"
          title="Rotate Left"
        >
          <RotateCcw size={14} />
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); onRotate('cw'); }}
          className="p-1.5 bg-black/60 backdrop-blur-md rounded-lg text-white hover:bg-[#faa916] transition-colors shadow-lg"
          title="Rotate Right"
        >
          <RotateCw size={14} />
        </button>
        <button 
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="p-1.5 bg-black/60 backdrop-blur-md rounded-lg text-white hover:bg-red-500 transition-colors shadow-lg"
          title="Remove Page"
        >
          <Trash size={14} />
        </button>
      </div>

      <div className="absolute top-2 left-2 z-10 min-w-[28px] h-7 px-1.5 rounded-lg bg-[#1b1b1e]/90 backdrop-blur-md border border-[#fbfffe]/30 flex items-center justify-center text-[#fbfffe] text-[10px] font-bold shadow-lg pointer-events-none">
        {pageNum}
      </div>
      
      {groupLabel && (
        <div 
          className="absolute bottom-2 inset-x-2 z-10 px-2 py-1.5 rounded-lg text-[9px] font-bold shadow-2xl pointer-events-none flex items-center justify-center gap-1.5 text-white border border-white/20 backdrop-blur-md"
          style={{ backgroundColor: groupColor }}
        >
          <Calendar size={10} />
          <span className="truncate">{groupLabel}</span>
        </div>
      )}

      <div className="w-full h-full p-2 flex items-center justify-center pointer-events-none">
        <div style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)' }} className="w-full h-full flex items-center justify-center">
          <canvas 
            ref={canvasRef} 
            className="max-w-full max-h-full w-auto h-auto object-contain shadow-2xl"
          />
        </div>
      </div>
      {(!isRendered || !isVisible) && (
        <div className="absolute inset-0 flex items-center justify-center text-[#fbfffe]/40 bg-white/5">
          <Loader2 className="animate-spin" size={24} />
        </div>
      )}
    </motion.div>
  );
});

export default function PdfEditor({ file, onClose }: PdfEditorProps) {
  const [pdfProxy, setPdfProxy] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [lastSelected, setLastSelected] = useState<number | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [pageStates, setPageStates] = useState<Record<number, PageState>>({});
  const [dateInput, setDateInput] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(3); // 1 = zoomed out (4 cols), 4 = zoomed in (1 col)
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);
  
  // AI Detection State
  const [isDetecting, setIsDetecting] = useState(false);
  const [learnedKnowledge, setLearnedKnowledge] = useState<Record<string, string>>({}); // layout -> date pattern
  const [lastAIDetection, setLastAIDetection] = useState<{ layout: string, date: string } | null>(null);
  
  // Undo/Redo State
  const [past, setPast] = useState<HistorySnapshot[]>([]);
  const [future, setFuture] = useState<HistorySnapshot[]>([]);

  const recordHistory = () => {
    // Optimized cloning instead of JSON.stringify
    const snapshot: HistorySnapshot = {
      groups: groups.map(g => ({
        ...g,
        pages: [...g.pages],
        parsedDate: g.parsedDate ? new Date(g.parsedDate.getTime()) : null
      })),
      pageStates: { ...pageStates }
    };
    setPast(prev => [...prev.slice(-49), snapshot]); // Limit history to 50 steps
    setFuture([]);
  };

  const undo = () => {
    if (past.length === 0) return;
    
    const currentSnapshot: HistorySnapshot = {
      groups: groups.map(g => ({
        ...g,
        pages: [...g.pages],
        parsedDate: g.parsedDate ? new Date(g.parsedDate.getTime()) : null
      })),
      pageStates: { ...pageStates }
    };
    
    const previous = past[past.length - 1];
    const newPast = past.slice(0, past.length - 1);
    
    setFuture(prev => [currentSnapshot, ...prev]);
    setGroups(previous.groups);
    setPageStates(previous.pageStates);
    setPast(newPast);
  };

  const redo = () => {
    if (future.length === 0) return;

    const currentSnapshot: HistorySnapshot = {
      groups: groups.map(g => ({
        ...g,
        pages: [...g.pages],
        parsedDate: g.parsedDate ? new Date(g.parsedDate.getTime()) : null
      })),
      pageStates: { ...pageStates }
    };

    const next = future[0];
    const newFuture = future.slice(1);

    setPast(prev => [...prev, currentSnapshot]);
    setGroups(next.groups);
    setPageStates(next.pageStates);
    setFuture(newFuture);
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const scrollTop = e.currentTarget.scrollTop;
    setShowScrollTop(scrollTop > 400);
  };

  const handleScrollToTop = () => {
    const container = document.getElementById('pdf-scroll-container');
    if (container) {
      container.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    let isActive = true;
    const loadPdf = async () => {
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        if (!isActive) return;
        setPdfProxy(pdf);
        setNumPages(pdf.numPages);
      } catch (err) {
        console.error("Error loading PDF for editor:", err);
        alert("Հնարավոր չէ բացել այս ֆայլը (Failed to open file)");
        onClose();
      }
    };
    loadPdf();
    return () => { isActive = false; };
  }, [file, onClose]);

  // Memoized handles
  const handleToggleSelect = React.useCallback((pageNum: number, isShift: boolean) => {
    setSelectedPages(prev => {
      const next = new Set(prev);
      if (isShift && lastSelected !== null) {
        const start = Math.min(pageNum, lastSelected);
        const end = Math.max(pageNum, lastSelected);
        const isDeselecting = prev.has(pageNum);
        for (let i = start; i <= end; i++) {
          if (isDeselecting) next.delete(i);
          else next.add(i);
        }
      } else {
        if (next.has(pageNum)) next.delete(pageNum);
        else next.add(pageNum);
      }
      return next;
    });
    setLastSelected(pageNum);
  }, [lastSelected]);

  const handleRotatePage = React.useCallback((pageNum: number, direction: 'cw' | 'ccw') => {
    recordHistory();
    setPageStates(prev => {
      const current = prev[pageNum] || { rotation: 0, isRemoved: false };
      const change = direction === 'cw' ? 90 : -90;
      return {
        ...prev,
        [pageNum]: { ...current, rotation: (current.rotation + change) % 360 }
      };
    });
  }, [pageStates, groups]);

  const handleRemovePage = React.useCallback((pageNum: number) => {
    recordHistory();
    setPageStates(prev => {
      const current = prev[pageNum] || { rotation: 0, isRemoved: false };
      return {
        ...prev,
        [pageNum]: { ...current, isRemoved: !current.isRemoved }
      };
    });
    
    // Also remove from selection if being removed
    setSelectedPages(prev => {
      const next = new Set(prev);
      next.delete(pageNum);
      return next;
    });

    // Remove from groups if being removed
    setGroups(prev => prev.map(g => ({
      ...g,
      pages: g.pages.filter(p => p !== pageNum)
    })).filter(g => g.pages.length > 0));
  }, [pageStates, groups]);

  const parseDate = (dStr: string): Date | null => {
    const match = dStr.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
    if (!match) return null;
    let d = parseInt(match[1]), m = parseInt(match[2]), y = parseInt(match[3]);
    if (y < 100) {
      y += 2000;
    }
    const dt = new Date(y, m - 1, d);
    if (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) return dt;
    return null;
  };

  const handleCreateGroup = () => {
    if (selectedPages.size === 0) return;
    const parsed = parseDate(dateInput);
    if (!parsed) {
      alert("Խնդրում ենք մուտքագրել վավեր ամսաթիվ DD-MM-YYYY ձևաչափով (Please enter a valid format DD-MM-YYYY)");
      return;
    }

    // Feedback Logic: If user corrected AI's suggestion, learn from it
    if (lastAIDetection && lastAIDetection.date !== dateInput) {
      setLearnedKnowledge(prev => ({
        ...prev,
        [lastAIDetection.layout]: dateInput
      }));
      setSuccessMessage(`🧠 Համակարգը սովորեց ձեր ուղղումից:`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } else if (lastAIDetection) {
      // confirm it was correct
      setLearnedKnowledge(prev => ({
        ...prev,
        [lastAIDetection.layout]: dateInput
      }));
    }

    recordHistory();
    const newPages = Array.from<number>(selectedPages).sort((a, b) => a - b);
    const newGroup: Group = {
      id: Math.random().toString(36).substr(2, 9),
      pages: newPages,
      dateInput,
      parsedDate: parsed
    };

    setGroups(prev => {
      // Remove newly selected pages from any existing groups
      const updatedGroups = prev.map(g => ({
        ...g,
        pages: g.pages.filter(p => !selectedPages.has(p))
      })).filter(g => g.pages.length > 0);
      
      return [...updatedGroups, newGroup];
    });

    const count = selectedPages.size;
    setSelectedPages(new Set());
    setDateInput('');
    setSuccessMessage(`✅ Հաստատվեց: ${count} էջեր կցվեցին ${dateInput} ամսաթվին։`);
    setTimeout(() => setSuccessMessage(null), 3500);
  };

  const handleDeleteGroup = (id: string) => {
    const groupToRemove = groups.find(g => g.id === id);
    if (groupToRemove) {
      recordHistory();
      setGroups(prev => prev.filter(g => g.id !== id));
      setSuccessMessage(`🗑️ Խումբը հեռացվեց (${groupToRemove.dateInput})`);
      setTimeout(() => setSuccessMessage(null), 3000);
    }
  };

  const handleUpdateGroupPages = (id: string, newPages: number[]) => {
    recordHistory();
    setGroups(prev => prev.map(g => g.id === id ? { ...g, pages: newPages } : g));
  };

  const handleAutoDetect = async () => {
    if (selectedPages.size === 0 || !pdfProxy) return;
    
    setIsDetecting(true);
    try {
      // Pick the first selected page for layout analysis
      const pageNum = Array.from(selectedPages)[0];
      const page = await pdfProxy.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
      
      const base64 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
      
      const knowledgeContext = Object.entries(learnedKnowledge)
        .map(([layout, date]) => `Layout "${layout}" usually identifies as date "${date}"`)
        .join('\n');

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: {
          parts: [
            { inlineData: { data: base64, mimeType: "image/jpeg" } },
            { text: `Analyze the document and find the date.
              
              CONTEXT (User Corrections):
              ${knowledgeContext || "No previous examples."}
              
              CRITICAL: If the document layout matches a previous example, use that logic. 
              Output JSON: { "date": "DD-MM-YYYY", "layout": "Unique Layout ID", "confidence": 0.99 }
            ` }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              date: { type: Type.STRING },
              layout: { type: Type.STRING },
              confidence: { type: Type.NUMBER }
            }
          }
        }
      });

      const res = JSON.parse(response.text);
      if (res.date) {
        setDateInput(res.date);
        setLastAIDetection({ layout: res.layout, date: res.date });
        setSuccessMessage(`✨ AI-ն առաջարկում է: ${res.date} (${res.layout})`);
        setTimeout(() => setSuccessMessage(null), 4000);
      }
    } catch (err) {
      console.error("AI detection error", err);
      setSuccessMessage("❌ AI-ն չկարողացավ ճանաչել ամսաթիվը");
      setTimeout(() => setSuccessMessage(null), 3000);
    } finally {
      setIsDetecting(false);
    }
  };

  const handleExport = async (split = false) => {
    try {
      setIsExporting(true);
      const originalBytes = await file.arrayBuffer();
      const pdfDoc = await PDFDocument.load(originalBytes);

      // Helper to clone and apply transformation to a page
      const preparePage = async (targetDoc: PDFDocument, sourceDoc: PDFDocument, pageNum: number) => {
        const state = pageStates[pageNum] || { rotation: 0, isRemoved: false };
        if (state.isRemoved) return null;

        const [copiedPage] = await targetDoc.copyPages(sourceDoc, [pageNum - 1]);
        const currentRotation = copiedPage.getRotation().angle;
        copiedPage.setRotation(degrees((currentRotation + state.rotation) % 360));
        return copiedPage;
      };

      if (split) {
        for (let i = 0; i < groups.length; i++) {
          const group = groups[i];
          const newPdfDoc = await PDFDocument.create();
          
          let added = 0;
          for (const p of group.pages) {
            const page = await preparePage(newPdfDoc, pdfDoc, p);
            if (page) {
              newPdfDoc.addPage(page);
              added++;
            }
          }

          if (added === 0) continue;

          const pdfBytes = await newPdfDoc.save();
          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const dateStr = group.dateInput.replace(/[^a-z0-9]/gi, '_');
          a.download = `Split_${dateStr || i+1}_${file.name}`;
          a.click();
          URL.revokeObjectURL(url);
          
          if (groups.length > 1) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
        setSuccessMessage(`✂️ Ֆայլը բաժանվեց ${groups.length} մասի`);
        setTimeout(() => setSuccessMessage(null), 3000);
      } else {
        const newPdfDoc = await PDFDocument.create();
        const sortedGroups = [...groups].sort((a, b) => {
          return (a.parsedDate?.getTime() || 0) - (b.parsedDate?.getTime() || 0);
        });

        const assignedPages = new Set<number>();
        for (const group of sortedGroups) {
          for (const p of group.pages) {
            assignedPages.add(p);
            const page = await preparePage(newPdfDoc, pdfDoc, p);
            if (page) newPdfDoc.addPage(page);
          }
        }

        for (let i = 1; i <= numPages; i++) {
          if (!assignedPages.has(i)) {
            const page = await preparePage(newPdfDoc, pdfDoc, i);
            if (page) newPdfDoc.addPage(page);
          }
        }

        const pdfBytes = await newPdfDoc.save();
        const blob = new Blob([pdfBytes], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Reordered_${file.name}`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Export error:", err);
      alert("Տեղի է ունեցել սխալ ֆայլը արտահանելիս (Error exporting file)");
    } finally {
      setIsExporting(false);
    }
  };

  const getPageGroupInfo = (pageNum: number) => {
    const groupIdx = groups.findIndex(g => g.pages.includes(pageNum));
    if (groupIdx === -1) return { label: undefined, color: undefined };
    return { 
      label: groups[groupIdx].dateInput, 
      color: GROUP_COLORS[groupIdx % GROUP_COLORS.length] 
    };
  };

  const scrollToPage = (pageNum: number) => {
    const element = document.getElementById(`page-${pageNum}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-6 lg:p-8 bg-black/80 backdrop-blur-md">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="w-full h-full max-w-[1600px] bg-[#1b1b1e] rounded-[1.5rem] overflow-hidden flex flex-col font-sans shadow-[0_0_80px_rgba(0,0,0,0.8)] border border-[#fbfffe]/10"
      >
        {/* Header */}
        <div className="h-14 bg-[#1b1b1e]/60 backdrop-blur-xl border-b border-[#fbfffe]/10 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-[#fbfffe]/10 rounded-lg">
              <Layers className="text-[#fbfffe]" size={20} />
            </div>
            <div>
              <h2 className="text-[#fbfffe] font-semibold text-base tracking-tight">Studio</h2>
              <p className="text-[#fbfffe]/40 text-[10px] font-mono">{file.name}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-[#fbfffe]/5 p-1 rounded-xl border border-[#fbfffe]/10 mr-2">
              <button 
                onClick={undo}
                disabled={past.length === 0}
                className="p-2 text-[#fbfffe]/60 hover:text-[#fbfffe] hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all rounded-lg"
                title="Հետարկել (Undo)"
              >
                <Undo2 size={18} />
              </button>
              <button 
                onClick={redo}
                disabled={future.length === 0}
                className="p-2 text-[#fbfffe]/60 hover:text-[#fbfffe] hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-all rounded-lg"
                title="Կրկնել (Redo)"
              >
                <Redo2 size={18} />
              </button>
            </div>

            <button 
              onClick={() => handleExport(true)}
              disabled={isExporting || groups.length === 0}
              className="flex items-center gap-2 bg-[#fbfffe]/10 hover:bg-[#fbfffe]/20 text-[#fbfffe] px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-[#fbfffe]/10"
              title="Յուրաքանչյուր խումբ արտահանել որպես առանձին ֆայլ"
            >
              <Scissors size={14} />
              Բաժանել
            </button>
            <button 
              onClick={() => handleExport(false)}
              disabled={isExporting || groups.length === 0}
              className="flex items-center gap-2 bg-[#faa916] hover:bg-[#faa916]/80 text-[#1b1b1e] px-4 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 shadow-lg shadow-[#faa916]/5"
              title="Արտահանել որպես մեկ վերադասավորված ֆայլ"
            >
              {isExporting ? <Loader2 className="animate-spin" size={14} /> : <Download size={14} />}
              Արտահանել
            </button>
            <div className="w-px h-6 bg-[#fbfffe]/10 mx-1" />
            <button onClick={onClose} className="text-[#fbfffe]/60 hover:text-[#fbfffe] hover:bg-white/5 transition-all p-2 rounded-full">
              <X size={20} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0 bg-[#1b1b1e]">
          {/* Sidebar - Groups */}
          <div className="w-72 bg-black/10 border-r border-[#fbfffe]/10 flex flex-col min-h-0 relative z-10 shadow-2xl">
            <div className="p-5 border-b border-[#fbfffe]/10 bg-black/5">
              <h3 className="text-[#fbfffe] text-[9px] uppercase tracking-[0.2em] font-mono mb-4 flex items-center gap-2 opacity-90">
                <Calendar size={14} className="text-[#fbfffe]" />
                Ստեղծել Խումբ
              </h3>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-[9px] text-[#fbfffe]/60 mb-1.5 font-mono uppercase tracking-widest pl-1">Ամսաթիվ</label>
                  <div className="relative group/input">
                    <input 
                      type="text" 
                      value={dateInput}
                      onChange={(e) => setDateInput(e.target.value)}
                      placeholder="DD-MM-YYYY"
                      className="w-full bg-[#1b1b1e]/60 border border-[#fbfffe]/10 text-[#fbfffe] px-3 py-3 rounded-xl outline-none focus:border-[#faa916] focus:bg-[#1b1b1e] transition-all font-mono text-center text-base placeholder:text-[#fbfffe]/20 shadow-inner pr-10"
                    />
                    <div className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                      <button 
                        onClick={handleAutoDetect}
                        disabled={isDetecting || selectedPages.size === 0}
                        className="p-1.5 bg-[#faa916]/10 text-[#faa916] hover:bg-[#faa916]/20 rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed group-hover/input:scale-105 active:scale-95"
                        title="AI-ով ճանաչել ամսաթիվը"
                      >
                        {isDetecting ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                      </button>
                      <div className="relative h-6 w-[1px] bg-[#fbfffe]/10 mx-0.5" />
                      <div className="relative">
                        <input 
                          type="date"
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                          onChange={(e) => {
                            const val = e.target.value;
                            if (!val) return;
                            const [y, m, d] = val.split('-');
                            setDateInput(`${d}-${m}-${y}`);
                          }}
                        />
                        <div className="p-1.5 bg-[#fbfffe]/5 rounded-lg text-[#fbfffe]/40 hover:text-[#fbfffe] transition-colors pointer-events-none">
                          <Calendar size={16} />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {Object.keys(learnedKnowledge).length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="bg-[#faa916]/5 border border-[#faa916]/20 rounded-xl p-3 flex items-start gap-3 relative overflow-hidden group"
                  >
                    <div className="absolute top-0 right-0 p-1 opacity-20 group-hover:opacity-100 transition-opacity">
                      <Lightbulb size={12} className="text-[#faa916] animate-pulse" />
                    </div>
                    <div className="p-1.5 bg-[#faa916]/20 rounded-lg text-[#faa916] shrink-0">
                      <BrainCircuit size={16} />
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] text-[#fbfffe] leading-relaxed font-medium">
                        Համակարգը հիշում է <span className="text-[#faa916] font-bold">{Object.keys(learnedKnowledge).length}</span> տիպի փաստաթղթերի տրամաբանությունը` հիմնված ձեր ուղղումների վրա:
                      </p>
                    </div>
                  </motion.div>
                )}

                <button 
                  onClick={handleCreateGroup}
                  disabled={selectedPages.size === 0}
                  className="w-full bg-[#fbfffe] hover:bg-[#fbfffe]/90 text-[#1b1b1e] py-3 rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:bg-[#1b1b1e]/40 disabled:text-[#fbfffe]/40 flex items-center justify-center gap-2 shadow-lg"
                >
                  <CheckCircle2 size={16} />
                  Հաստատել
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-transparent shrink-0 overscroll-contain">
              <h3 className="text-[#fbfffe]/60 text-[9px] uppercase tracking-[0.2em] font-mono mb-4 px-2">
                Խմբեր ({groups.length})
              </h3>
              <AnimatePresence>
                {groups.length === 0 && (
                  <div className="text-center text-[#fbfffe]/40 text-[10px] font-mono p-4 border-2 border-dashed border-[#fbfffe]/10 rounded-xl mx-2">
                    Ընտրեք էջեր
                  </div>
                )}
                {groups.map((group, idx) => (
                  <motion.div 
                    key={group.id}
                    initial={{ opacity: 0, x: -15 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.95, x: 15 }}
                    layout
                    className="bg-[#1b1b1e] border rounded-xl p-3 relative group transition-all duration-300 shadow-xl mx-1 hover:border-[#fbfffe]/20"
                    style={{ borderColor: `${GROUP_COLORS[idx % GROUP_COLORS.length]}33` }}
                  >
                    <div className="font-bold text-sm mb-2 flex items-center gap-2" style={{ color: GROUP_COLORS[idx % GROUP_COLORS.length] }}>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: GROUP_COLORS[idx % GROUP_COLORS.length] }} />
                      {group.dateInput}
                    </div>
                    
                    <div className="space-y-1.5">
                       <Reorder.Group 
                         axis="y" 
                         values={group.pages} 
                         onReorder={(newOrder) => handleUpdateGroupPages(group.id, newOrder)}
                         className="space-y-1"
                       >
                         {group.pages.map((pageNum) => (
                           <Reorder.Item 
                             key={pageNum} 
                             value={pageNum}
                             className="bg-white/5 hover:bg-white/10 border border-white/5 rounded-lg p-2 flex items-center gap-2 cursor-grab active:cursor-grabbing transition-colors group/item"
                           >
                             <GripVertical size={14} className="text-[#fbfffe]/40" />
                             <span className="text-[10px] font-mono text-[#fbfffe] opacity-80" onClick={() => scrollToPage(pageNum)}>էջ {pageNum}</span>
                             <div className="ml-auto w-4 h-4 rounded bg-[#fbfffe]/10 flex items-center justify-center text-[8px] text-[#fbfffe] font-bold">
                               #{pageNum}
                             </div>
                           </Reorder.Item>
                         ))}
                       </Reorder.Group>
                    </div>
                    <button 
                      onClick={() => handleDeleteGroup(group.id)}
                      className="absolute top-2 right-2 text-[#fbfffe]/20 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1"
                    >
                      <Trash2 size={14} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>

          {/* Thumbnail Sidebar */}
          <div className="w-48 bg-black/20 border-r border-[#fbfffe]/10 flex flex-col min-h-0 relative shadow-inner">
            <div className="p-4 border-b border-[#fbfffe]/10 bg-black/5 flex items-center justify-between">
              <h3 className="text-[#fbfffe]/60 text-[9px] uppercase tracking-[0.2em] font-mono">
                Տեսադարան ({numPages})
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar overscroll-contain">
              {pdfProxy && Array.from({ length: numPages }).map((_, i) => {
                const pageNum = i + 1;
                const state = pageStates[pageNum] || { rotation: 0, isRemoved: false };
                if (state.isRemoved) return null;

                return (
                  <div 
                    key={`thumb-${pageNum}`}
                    onClick={() => scrollToPage(pageNum)}
                    className="group relative cursor-pointer"
                  >
                    <div className="absolute top-1 left-1 z-10 w-5 h-5 rounded-md bg-black/60 backdrop-blur-md flex items-center justify-center text-[8px] font-bold text-white border border-white/20">
                      {pageNum}
                    </div>
                    <div 
                      className="aspect-[1/1.4] bg-white rounded-lg border-2 border-transparent group-hover:border-[#faa916] transition-all overflow-hidden flex items-center justify-center p-1"
                    >
                       <PdfThumbnail pageNum={pageNum} pdfProxy={pdfProxy} rotation={state.rotation} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main Grid area */}
          <div className="flex-1 bg-transparent flex flex-col relative min-h-0">
            {/* Toolbar */}
            <div className="h-12 bg-[#1b1b1e]/60 border-b border-[#fbfffe]/10 flex items-center justify-between px-6 shrink-0 backdrop-blur-md">
              <div className="flex items-center gap-4 text-[10px] text-[#fbfffe]/60 font-mono uppercase tracking-widest">
                <span className="flex items-center gap-1.5">Էջեր<strong className="text-[#fbfffe]">{numPages}</strong></span>
                <span className="w-1 h-1 rounded-full bg-[#fbfffe]/30" />
                <span className="flex items-center gap-1.5 text-[#faa916]">Ընտրված<strong>{selectedPages.size}</strong></span>
              </div>
              
              <div className="flex items-center gap-3 text-[#fbfffe]/60 bg-[#1b1b1e]/40 px-3 py-1 rounded-lg border border-[#fbfffe]/10">
                <button onClick={() => setZoomLevel(prev => Math.max(prev - 1, 1))}><ZoomOut size={14} /></button>
                <input 
                  type="range" 
                  min="1" max="4" step="1"
                  value={zoomLevel} 
                  onChange={(e) => setZoomLevel(parseInt(e.target.value))}
                  className="w-24 accent-[#fbfffe]"
                />
                <button onClick={() => setZoomLevel(prev => Math.min(prev + 1, 4))}><ZoomIn size={14} /></button>
              </div>
            </div>

            {/* Grid View */}
            <div 
              id="pdf-scroll-container" 
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-6 custom-scrollbar min-h-0 bg-transparent overscroll-contain"
            >
              {!pdfProxy ? (
                <div className="h-full flex items-center justify-center">
                  <div className="flex flex-col items-center gap-3 text-[#fbfffe]/40">
                    <Loader2 className="animate-spin" size={32} />
                    <span className="text-[10px] font-mono tracking-widest uppercase">Loading...</span>
                  </div>
                </div>
              ) : (
                <div 
                  className="grid gap-6"
                  style={{ 
                    gridTemplateColumns: `repeat(${5 - zoomLevel}, minmax(0, 1fr))` 
                  }}
                >
                    {Array.from({ length: numPages }).map((_, i) => {
                      const pageNum = i + 1;
                      if (pageStates[pageNum]?.isRemoved) return null;
                      
                      const groupInfo = getPageGroupInfo(pageNum);
                      return (
                        <PdfPage 
                          key={pageNum}
                          pdfProxy={pdfProxy}
                          pageNum={pageNum}
                          isSelected={selectedPages.has(pageNum)}
                          onToggleSelect={handleToggleSelect}
                          groupLabel={groupInfo.label}
                          groupColor={groupInfo.color}
                          rotation={pageStates[pageNum]?.rotation}
                          onRotate={(dir) => handleRotatePage(pageNum, dir)}
                          onRemove={() => handleRemovePage(pageNum)}
                        />
                      );
                    })}
                </div>
              )}
            </div>

            {/* Success Toast */}
            <AnimatePresence>
              {successMessage && (
                <motion.div
                  initial={{ opacity: 0, y: 20, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 20, scale: 0.9 }}
                  className="absolute bottom-8 left-1/2 -translate-x-1/2 bg-[#1b1b1e] text-[#fbfffe] px-8 py-4 rounded-2xl font-bold shadow-[0_20px_50px_rgba(0,0,0,0.5)] flex items-center gap-4 z-50 text-sm border border-[#fbfffe]/30 backdrop-blur-md"
                >
                  <div className="bg-[#faa916]/20 p-1.5 rounded-full text-[#faa916]">
                    <CheckCircle2 size={20} />
                  </div>
                  {successMessage}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Scroll to Top Button */}
            <AnimatePresence>
              {showScrollTop && (
                <motion.button
                  initial={{ opacity: 0, y: 10, scale: 0.8 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.8 }}
                  onClick={handleScrollToTop}
                  className="absolute bottom-8 right-8 p-4 bg-[#faa916] text-[#1b1b1e] rounded-full shadow-2xl hover:bg-[#faa916]/90 transition-all z-40 border-4 border-[#1b1b1e]"
                >
                  <ArrowUp size={24} />
                </motion.button>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
