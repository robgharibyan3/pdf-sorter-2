/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';
// @ts-ignore
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { motion, AnimatePresence } from 'motion/react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { 
  FileUp, 
  Calendar, 
  Clock, 
  Trash2, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ArrowUpDown,
  FileText,
  BrainCircuit,
  ChevronRight,
  Info,
  ZoomIn,
  X,
  FileWarning,
  MessageSquareWarning,
  Scissors,
  Pencil,
  Layers,
  Zap
} from 'lucide-react';
import { db, auth, signInWithGoogle } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { onAuthStateChanged, User } from 'firebase/auth';
import PdfEditor from './PdfEditor';

// Initialize PDF.js worker using local worker via Vite
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Types
interface DocResult {
  id: string;
  name: string;
  date: Date | null;
  rawDate: string | null;
  method: 'metadata' | 'text' | 'smart' | 'gemini' | 'unknown';
  status: 'pending' | 'processing' | 'success' | 'error';
  error?: string;
  context?: string;
  reasoning?: string;
  visualEvidence?: string;
}

const GEMINI_MODEL = "gemini-3-flash-preview";

// --- Month Dictionaries from original logic ---
const ARM_MONTHS: Record<string, number> = {
  'հունվարի':1,'հունվար':1,'հուն':1, 'փետրվարի':2,'փետրվար':2,'փետ':2, 'մարտի':3,'մարտ':3,'մրտ':3,
  'ապրիլի':4,'ապրիլ':4,'ապր':4, 'մայիսի':5,'մայիս':5,'մայ':5, 'հունիսի':6,'հունիս':6,'հնս':6,
  'հուլիսի':7,'հուլիս':7,'հուլ':7, 'օգոստոսի':8,'օգոստոս':8,'օգ':8, 'սեպտեմբերի':9,'սեպտեմբեր':9,'սեպ':9,
  'հոկտեմբերի':10,'հոկտեմբեր':10,'հոկ':10, 'նոյեմբերի':11,'նոյեմբեր':11,'նոյ':11, 'դեկտեմբերի':12,'դեկտեմբեր':12,'դեկ':12
};
const RUS_MONTHS: Record<string, number> = {
  'января':1,'январь':1,'янв':1, 'февраля':2,'февраль':2,'фев':2, 'марта':3,'март':3,'мар':3,
  'апреля':4,'апрель':4,'апр':4, 'мая':5,'май':5, 'июня':6,'июнь':6,'июн':6, 'июля':7,'июль':7,'июл':7,
  'августа':8,'август':8,'авг':8, 'сентября':9,'сентябрь':9,'сен':9, 'октября':10,'октябрь':10,'окт':10,
  'ноября':11,'ноябрь':11,'ноя':11, 'декабря':12,'декабрь':12,'дек':12
};
const ENG_MONTHS: Record<string, number> = {
  'january':1,'jan':1,'february':2,'feb':2, 'march':3,'mar':3,'april':4,'apr':4, 'may':5,
  'june':6,'jun':6,'july':7,'jul':7, 'august':8,'aug':8, 'september':9,'sep':9,'sept':9,
  'october':10,'oct':10,'november':11,'nov':11, 'december':12,'dec':12
};

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<DocResult[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [progress, setProgress] = useState(0);
  const [geminiCount, setGeminiCount] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<File | null>(null);
  const [feedbackDocId, setFeedbackDocId] = useState<string | null>(null);
  const [feedbackExpectedDate, setFeedbackExpectedDate] = useState('');
  const [feedbackComments, setFeedbackComments] = useState('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const submitFeedback = async (resId: string) => {
    if (!user) {
      await signInWithGoogle();
      return;
    }
    
    const res = results.find(r => r.id === resId);
    if (!res) return;

    setIsSubmittingFeedback(true);
    try {
      await addDoc(collection(db, 'feedback'), {
        userId: user.uid,
        fileName: res.name,
        extractedDate: res.date ? formatDateDDMMYYYY(res.date) : (res.rawDate || 'none'),
        expectedDate: feedbackExpectedDate,
        comments: feedbackComments,
        createdAt: serverTimestamp()
      });
      setFeedbackDocId(null);
      setFeedbackExpectedDate('');
      setFeedbackComments('');
      alert("Շնորհակալություն հետադարձ կապի համար։ (Thank you for your feedback!)");
    } catch (error) {
      console.error("Error submitting feedback:", error);
      alert("Սխալ տեղի ունեցավ: Խնդրում ենք փորձել կրկին:");
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const formatDateDDMMYYYY = (date: Date) => {
    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}-${m}-${y}`;
  };

  const isValidDate = (d: number, m: number, y: number) => {
    if (y < 1900 || y > 2100) return false;
    if (m < 1 || m > 12) return false;
    if (d < 1 || d > 31) return false;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  };

  const normalizeText = (text: string) => {
    return text
      .replace(/[,،]/g, '.')
      .replace(/[—–]/g, '-')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  const hasTimestampNearby = (text: string, matchIndex: number, matchLength: number) => {
    const windowSize = 30;
    const start = Math.max(0, matchIndex - windowSize);
    const end = Math.min(text.length, matchIndex + matchLength + windowSize);
    const surrounding = text.substring(start, end);
    return /\b\d{1,2}:\d{2}(?::\d{2})?(\s?[AP]M)?\b/i.test(surrounding) || 
           /\b\d{1,2}\s?:\s?\d{2}\b/.test(surrounding);
  };

  const extractAllDates = (rawText: string): { date: Date, raw: string, context: string, score: number } | null => {
    const t = normalizeText(rawText).replace(/«|»/g, '');
    const today = new Date();
    const candidates: { date: Date, raw: string, context: string, score: number }[] = [];

    const getContext = (match: string, fullText: string) => {
      const idx = fullText.indexOf(match);
      if (idx === -1) return match;
      const start = Math.max(0, idx - 60);
      const end = Math.min(fullText.length, idx + match.length + 60);
      const before = fullText.substring(start, idx);
      const after = fullText.substring(idx + match.length, end);
      return (start > 0 ? "..." : "") + before + " [ " + match + " ] " + after + (end < fullText.length ? "..." : "");
    };

    const addCandidate = (d: number, m: number, y: number, raw: string, index: number) => {
      if (isValidDate(d, m, y)) {
        const dt = new Date(y, m - 1, d);
        let positionPenalty = index;
        const recencyScore = (Math.abs(today.getTime() - dt.getTime()) / 86400000) * 0.1;
        
        let headerBonus = 0;
        let contextPenalty = 0;
        const windowSize = 250;
        const start = Math.max(0, index - windowSize);
        const end = Math.min(t.length, index + raw.length + windowSize);
        const surrounding = t.substring(start, end);
        
        if (/(?:[ԵՆՓԱԲԳԴԶԷԸԹԺԻԼԽԾԿՀՁՂՃՄՅՆՇՈՉՊՋՌՍՎՏՐՑՈՒՓՔՕՖև]|№|N|Nº|No)\s*(?:[Ա-Ֆա-ֆ]\s*)?-?\s*\d+/i.test(surrounding)) {
          headerBonus -= 5000;
        }
        if (/(?:ք\.|քաղաք)\s*[Ա-Ֆա-ֆԱ-Ֆ]+/i.test(surrounding) || /ՈՐՈՇՈՒՄ|ՎՃԻՌ|ՀՐԱՄԱՆ|ԱՐՁԱՆԱԳՐՈՒԹՅՈՒՆ|ՍՏԱՑԱԿԱՆ|Ո Ր Ո Շ ՈՒ Մ/i.test(surrounding)) {
          headerBonus -= 4500;
        }
        if (index < 300) {
          headerBonus -= 3000;
        }
        if (/ծննդյան|տրման|վավերական|անձնագիր|քարտ|տրված\s*է|ծնվ\.|ծնված|վկայական|գրանցման|հաշվառման|վճարման/i.test(surrounding)) {
          contextPenalty += 10000;
        }

        candidates.push({
          date: dt,
          raw: raw.trim(),
          context: getContext(raw, t),
          score: recencyScore + positionPenalty + headerBonus + contextPenalty + (y < 100 ? 3650 : 0)
        });
      }
    };

    let m;
    const armRe = /(\d{1,2})\s*-?(?:ին|ը)?\s+([\u0531-\u0587]{2,}\.?)\s+(\d{4})/gi;
    while ((m = armRe.exec(t)) !== null) {
      if (hasTimestampNearby(t, m.index, m[0].length)) continue;
      const day = parseInt(m[1]), yr = parseInt(m[3]);
      const key = m[2].replace(/\.$/,'').toLowerCase();
      for (const [k, v] of Object.entries(ARM_MONTHS)) {
        if (key === k || key.startsWith(k.replace(/\.$/,''))) {
          addCandidate(day, v, yr, m[0], m.index);
          break;
        }
      }
    }

    const rusRe = /(\d{1,2})\s+([\u0400-\u04FF]{3,}\.?)\s+(\d{4})/gi;
    while ((m = rusRe.exec(t)) !== null) {
      if (hasTimestampNearby(t, m.index, m[0].length)) continue;
      const day = parseInt(m[1]), yr = parseInt(m[3]);
      const key = m[2].replace(/\.$/,'').toLowerCase();
      for (const [k, v] of Object.entries(RUS_MONTHS)) {
        if (key === k || key.startsWith(k)) {
          addCandidate(day, v, yr, m[0], m.index);
          break;
        }
      }
    }

    const engRe = /(\d{1,2})\s+([A-Za-z]{3,}\.?),?\s+(\d{4})/g;
    while ((m = engRe.exec(t)) !== null) {
      if (hasTimestampNearby(t, m.index, m[0].length)) continue;
      const day = parseInt(m[1]), yr = parseInt(m[3]);
      const key = m[2].replace(/\.$/,'').toLowerCase();
      for (const [k, v] of Object.entries(ENG_MONTHS)) {
        if (key === k || key.startsWith(k)) {
          addCandidate(day, v, yr, m[0], m.index);
          break;
        }
      }
    }

    const numRe = /(?<!\d)(\d{1,4})(?:\s*[.\-\/]\s*|\s+)(\d{1,2})(?:\s*[.\-\/]\s*|\s+)(\d{1,4})(?!\d)/g;
    while ((m = numRe.exec(t)) !== null) {
      if (hasTimestampNearby(t, m.index, m[0].length)) continue;
      let a = parseInt(m[1]), b = parseInt(m[2]), c = parseInt(m[3]);
      
      const variants = [
        { y: c < 100 ? 2000 + c : c, mo: b, d: a },
        { y: a < 100 ? 2000 + a : a, mo: b, d: c },
      ];
      for (const v of variants) {
        addCandidate(v.d, v.mo, v.y, m[0], m.index);
      }
    }

    if (!candidates.length) return null;
    candidates.sort((a, b) => a.score - b.score);
    return candidates[0];
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const fileList = Array.from(e.target.files as FileList);
      const newFiles = fileList.filter(f => f.type === 'application/pdf');
      setFiles(prev => [...prev, ...newFiles]);
      
      const newResults: DocResult[] = newFiles.map(f => ({
        id: Math.random().toString(36).substr(2, 9),
        name: f.name,
        date: null,
        rawDate: null,
        method: 'unknown',
        status: 'pending'
      }));
      setResults(prev => [...prev, ...newResults]);
    }
  };

  const clearFiles = () => {
    setFiles([]);
    setResults([]);
    setProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const askGeminiForDate = async (base64Image: string): Promise<{ y: number, m: number, d: number, raw: string, reasoning: string, context: string } | null> => {
    setGeminiCount(prev => prev + 1);
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            parts: [
              { text: "Գտիր այս փաստաթղթի հիմնական պաշտոնական ամսաթիվը (ստեղծման կամ ստորագրման)։ ՈՒՇԱԴՐՈՒԹՅՈՒՆ. Անտեսիր էջի ամենավերևում կամ ամենաներքևում գտնվող տպման ամսաթվերը, որոնք սովորաբար ունեն ժամային նշում (օրինակ՝ 11:23 AM)։ Փնտրիր փաստաթղթի բուն տեքստի մեջ գտնվող ամսաթիվը։ Վերադարձրու ՄԻԱՅՆ JSON ֆորմատով՝ { \"date\": \"YYYY-MM-DD\", \"reasoning\": \"կարճ բացատրություն հայերենով\", \"source_text\": \"այն կոնկրետ տեքստային հատվածը, որտեղ գտար ամսաթիվը\" }։ Եթե չկա, գրիր 'null'։" },
              {
                inlineData: {
                  mimeType: "image/jpeg",
                  data: base64Image
                }
              }
            ]
          }
        ]
      });

      const text = response.text?.trim() || '';
      try {
        const json = JSON.parse(text.replace(/```json|```/g, ''));
        if (json && json.date && json.date !== 'null') {
          const match = json.date.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (match) {
            return {
              y: parseInt(match[1]),
              m: parseInt(match[2]),
              d: parseInt(match[3]),
              raw: json.date,
              reasoning: json.reasoning || "Գտնվել է AI-ի միջոցով",
              context: json.source_text || json.date
            };
          }
        }
      } catch (e) {
        const match = text.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (match) {
          return {
            y: parseInt(match[1]),
            m: parseInt(match[2]),
            d: parseInt(match[3]),
            raw: text,
            reasoning: "Գտնվել է AI-ի միջոցով",
            context: text
          };
        }
      }
      return null;
    } catch (error) {
      console.error("Gemini Error:", error);
      return null;
    }
  };

  const processFiles = async () => {
    if (files.length === 0) return;
    setIsProcessing(true);
    setProgress(0);

    const updatedResults = [...results];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const resultIndex = updatedResults.findIndex(r => r.name === file.name && r.status === 'pending');
      if (resultIndex === -1) continue;

      updatedResults[resultIndex].status = 'processing';
      setResults([...updatedResults]);

      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        let foundDate: Date | null = null;
        let rawDate: string | null = null;
        let method: DocResult['method'] = 'unknown';
        let contextStr: string | undefined;
        let reasoningStr: string | undefined;

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        const findTargetItem = (items: any[], rawMatch: string) => {
          let normalizedText = '';
          const charToItem: any[] = [];
          for (const item of items) {
            for (let i = 0; i < item.str.length; i++) {
              const char = item.str[i];
              if (char.trim() !== '' && char !== '«' && char !== '»') {
                normalizedText += char.toLowerCase();
                charToItem.push(item);
              }
            }
          }
          const rawNoSpace = rawMatch.replace(/[\s«»]/g, '').toLowerCase();
          const matchIdx = normalizedText.indexOf(rawNoSpace);
          if (matchIdx !== -1) return charToItem[matchIdx];
          
          const yearMatch = rawMatch.match(/\d{4}/);
          if (yearMatch) {
            const yearItem = items.find((it: any) => it.str.includes(yearMatch[0]));
            if (yearItem) return yearItem;
          }
          return items[0];
        };

        const captureFullPageEvidence = async (page: any, targetItem: any) => {
          const viewport = page.getViewport({ scale: 1.5 });
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          // @ts-ignore
          const renderTask = page.render({ canvasContext: context, viewport });
          await renderTask.promise;

          if (targetItem && context) {
            const [, , , , tx, ty] = targetItem.transform;
            const pt = viewport.convertToViewportPoint(tx, ty);
            const px = pt[0];
            const py = pt[1];
            
            const textWidth = (targetItem.width || 80) * viewport.scale;
            const textHeight = (targetItem.height || 12) * viewport.scale;
            
            context.fillStyle = 'rgba(200, 169, 110, 0.3)';
            context.strokeStyle = '#ef7b45';
            context.lineWidth = 3;
            
            context.fillRect(px - 10, py - textHeight - 10, textWidth + 20, textHeight + 20);
            context.strokeRect(px - 10, py - textHeight - 10, textWidth + 20, textHeight + 20);
          }
          
          return canvas.toDataURL('image/jpeg', 0.8);
        };

        for (let pNum = 1; pNum <= Math.min(pdf.numPages, 3); pNum++) {
          if (foundDate) break;
          const page = await pdf.getPage(pNum);
          const content = await page.getTextContent();
          const items = content.items as any[];
          const pageText = items.map(it => it.str).join(' ');

          const bestMatch = extractAllDates(pageText);

          if (bestMatch) {
            foundDate = bestMatch.date;
            rawDate = bestMatch.raw;
            method = 'smart';
            contextStr = bestMatch.context;

            if (context) {
              const targetItem = findTargetItem(items, bestMatch.raw);
              updatedResults[resultIndex].visualEvidence = await captureFullPageEvidence(page, targetItem);
            }
          }
        }

        if (!foundDate && pdf.numPages > 3) {
          const lastPage = await pdf.getPage(pdf.numPages);
          const content = await lastPage.getTextContent();
          const items = content.items as any[];
          const pageText = items.map(it => it.str).join(' ');
          
          const bestMatch = extractAllDates(pageText);
          
          if (bestMatch) {
            foundDate = bestMatch.date;
            rawDate = bestMatch.raw;
            method = 'smart';
            contextStr = bestMatch.context;

            if (context) {
              const targetItem = findTargetItem(items, bestMatch.raw);
              updatedResults[resultIndex].visualEvidence = await captureFullPageEvidence(lastPage, targetItem);
            }
          }
        }

        if (!foundDate) {
          const page1 = await pdf.getPage(1);
          const viewport1 = page1.getViewport({ scale: 1.5 });
          if (context) {
            canvas.height = viewport1.height;
            canvas.width = viewport1.width;
            // @ts-ignore
            await page1.render({ canvasContext: context, viewport: viewport1 }).promise;
            const base64Image1 = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
            
            const gFound = await askGeminiForDate(base64Image1);
            if (gFound) {
              foundDate = new Date(gFound.y, gFound.m - 1, gFound.d);
              rawDate = gFound.raw;
              method = 'gemini';
              reasoningStr = gFound.reasoning;
              contextStr = gFound.context;
              updatedResults[resultIndex].visualEvidence = `data:image/jpeg;base64,${base64Image1}`;
            } else if (pdf.numPages > 1) {
              const lastPage = await pdf.getPage(pdf.numPages);
              const viewportL = lastPage.getViewport({ scale: 1.5 });
              canvas.height = viewportL.height;
              canvas.width = viewportL.width;
              // @ts-ignore
              await lastPage.render({ canvasContext: context, viewport: viewportL }).promise;
              const base64ImageL = canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
              
              const gFoundL = await askGeminiForDate(base64ImageL);
              if (gFoundL) {
                foundDate = new Date(gFoundL.y, gFoundL.m - 1, gFoundL.d);
                rawDate = gFoundL.raw;
                method = 'gemini';
                reasoningStr = gFoundL.reasoning;
                contextStr = gFoundL.context;
                updatedResults[resultIndex].visualEvidence = `data:image/jpeg;base64,${base64ImageL}`;
              }
            }
          }
        }

        if (!foundDate) {
          const meta = await pdf.getMetadata();
          const creationDate = (meta.info as any)?.CreationDate;
          if (creationDate) {
            const match = creationDate.match(/D:(\d{4})(\d{2})(\d{2})/);
            if (match) {
              foundDate = new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
              rawDate = foundDate.toISOString().split('T')[0];
              method = 'metadata';
              contextStr = "Փաստաթղթի ներքին մետատվյալներ (CreationDate)";
            }
          }
        }

        updatedResults[resultIndex].date = foundDate;
        updatedResults[resultIndex].rawDate = rawDate;
        updatedResults[resultIndex].method = method;
        updatedResults[resultIndex].context = contextStr;
        updatedResults[resultIndex].reasoning = reasoningStr;
        updatedResults[resultIndex].status = foundDate ? 'success' : 'error';
        if (!foundDate) updatedResults[resultIndex].error = "Ամսաթիվը չհաջողվեց գտնել";

      } catch (error) {
        updatedResults[resultIndex].status = 'error';
        updatedResults[resultIndex].error = "Ֆայլի մշակման սխալ";
      }

      setResults([...updatedResults]);
      setProgress(((i + 1) / files.length) * 100);
    }

    setIsProcessing(false);
  };

  const handleManualDateChange = (id: string, newDateStr: string) => {
    const parts = newDateStr.split(/[-./]/).map(Number);
    if (parts.length === 3) {
      let y, m, d;
      if (parts[0] > 1000) {
        [y, m, d] = parts;
      } else {
        [d, m, y] = parts;
      }
      if (isValidDate(d, m, y)) {
        setResults(prev => prev.map(r => r.id === id ? {
          ...r,
          date: new Date(y, m - 1, d),
          rawDate: newDateStr,
          status: 'success'
        } : r));
      }
    }
  };

  const sortedResults = [...results].sort((a, b) => {
    if (!a.date) return 1;
    if (!b.date) return -1;
    return sortOrder === 'asc' ? a.date.getTime() - b.date.getTime() : b.date.getTime() - a.date.getTime();
  });

  return (
    <div className="min-h-screen bg-[#0d0d0e] text-[#fbfffe] font-sans selection:bg-[#faa916] selection:text-[#1b1b1e]">
      {/* Premium Background Ambiance */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-15%] left-[-10%] w-[60%] h-[60%] bg-[#faa916]/5 blur-[180px] rounded-full mix-blend-screen" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[60%] h-[60%] bg-[#96031a]/5 blur-[180px] rounded-full mix-blend-screen" />
        <div className="absolute top-[20%] right-[-5%] w-[40%] h-[40%] bg-[#3b82f6]/3 blur-[150px] rounded-full mix-blend-screen" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(250,169,22,0.015)_0%,transparent_80%)]" />
      </div>

      <div className="relative max-w-[1700px] mx-auto px-6 py-6 lg:py-8 h-screen flex flex-col overflow-hidden">
        {/* Header */}
        <header className="mb-8 flex flex-col lg:flex-row lg:items-center justify-between gap-6 shrink-0">
          <div className="space-y-3">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-4"
            >
              <div className="relative">
                <div className="absolute inset-0 bg-[#faa916] blur-2xl opacity-20 animate-pulse" />
                <div className="relative bg-gradient-to-br from-[#faa916] to-[#ef4444] text-[#1b1b1e] p-2.5 rounded-xl shadow-2xl flex items-center justify-center">
                  <BrainCircuit size={24} />
                </div>
              </div>
              <div>
                <h1 className="text-3xl font-black tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-[#fbfffe] via-[#fbfffe] to-[#faa916]">
                  ARCHIVE AI
                </h1>
                <div className="flex items-center gap-3 mt-0.5 text-[9px] font-mono uppercase tracking-[0.4em] text-[#fbfffe]/40">
                   <span>Chronological Sorter</span>
                   <div className="w-1 h-1 rounded-full bg-[#faa916]/50" />
                   <span className="text-[#faa916]">Premium v3.0</span>
                </div>
              </div>
            </motion.div>
            <p className="text-[#fbfffe]/60 text-[13px] leading-relaxed max-w-lg border-l-2 border-[#faa916]/20 pl-4 py-0.5">
              Ինտելեկտուալ լուծում փաստաթղթերի ավտոմատ դասակարգման համար։ 
              <span className="block mt-1 opacity-60 text-[10px] italic">Smart OCR + Gemini Vision integration.</span>
            </p>
          </div>
          
          <motion.div 
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="flex items-center gap-2 bg-white/[0.02] backdrop-blur-3xl border border-white/5 rounded-[2rem] p-1.5 shadow-2xl"
          >
            {/* Gemini Usage */}
            <div className="bg-white/[0.04] border border-white/5 rounded-[1.5rem] px-5 py-3 flex items-center gap-6 min-w-[180px]">
              <div className="flex flex-col">
                <span className="text-[8px] font-mono text-[#fbfffe]/30 uppercase tracking-[0.2em] mb-0.5">Gemini Engine</span>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-xl font-black text-[#faa916] font-mono leading-none">{geminiCount}</span>
                  <span className="text-[7.5px] text-[#fbfffe]/20 font-bold tracking-widest">TPS-REQ</span>
                </div>
              </div>
              <div className="flex-1 space-y-1.5">
                <div className="flex justify-between text-[7px] font-mono text-[#fbfffe]/20 uppercase">
                  <span>Usage</span>
                  <span>99.9%</span>
                </div>
                <div className="w-24 h-[3px] bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${(geminiCount / 1500) * 100}%` }}
                    transition={{ duration: 1.5, ease: "easeOut" }}
                    className="h-full bg-gradient-to-r from-[#faa916] to-[#ef4444]" 
                  />
                </div>
              </div>
            </div>

            {/* divider line */}
            <div className="w-px h-8 bg-white/5 mx-1" />

            {/* Health Stat */}
            <div className="px-5 py-3 flex items-center gap-4 min-w-[140px]">
              <div className="relative">
                <div className="w-3 h-3 rounded-full bg-emerald-500/20 animate-ping" />
                <div className="absolute inset-0 w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
              </div>
              <div className="flex flex-col">
                <span className="text-[8px] font-mono text-[#fbfffe]/30 uppercase tracking-[0.2em] mb-0.5">Engine Status</span>
                <span className="text-[10px] font-black text-emerald-400 tracking-wider uppercase leading-none">Operational</span>
                <span className="mt-1 text-[7px] text-white/20 font-mono">LATENCY: 42ms</span>
              </div>
            </div>
          </motion.div>
        </header>

        {/* Main Layout Grid */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start flex-1 overflow-hidden min-h-0">
          {/* Action Column */}
          <div className="xl:col-span-5 space-y-6 overflow-y-auto max-h-full pr-1 custom-scrollbar">
            <motion.div 
              onClick={() => fileInputRef.current?.click()}
              className={`
                relative bg-white/[0.03] border-2 border-dashed border-white/10 rounded-[2.5rem] p-12 text-center cursor-pointer
                transition-all duration-500 overflow-hidden shadow-2xl
                ${files.length > 0 ? 'bg-white/[0.06] border-[#faa916]/40 shadow-[#faa916]/10' : ''}
              `}
            >
              <div className="relative mb-6">
                <FileUp className="relative mx-auto text-white opacity-40 shadow-[0_0_20px_rgba(255,255,255,0.1)]" size={64} strokeWidth={0.8} />
              </div>

              <h3 className="text-3xl font-black mb-2 tracking-tight">Վերբեռնել PDF</h3>
              <p className="text-sm text-white/50 font-medium tracking-wide mb-6 opacity-80 uppercase tracking-[0.1em]">Ընտրեք կամ քաշեք ֆայլերը</p>
              <div className="inline-flex items-center gap-3 px-5 py-2 rounded-full bg-white/5 border border-white/10 text-[10px] font-mono text-white/40 uppercase tracking-[0.4em]">
                Adobe PDF Enterprise
              </div>

              <input 
                type="file" 
                ref={fileInputRef}
                onChange={handleFileChange}
                multiple 
                accept=".pdf" 
                className="hidden" 
              />
            </motion.div>

            <AnimatePresence>
              {files.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 20, scale: 0.95 }}
                  className="bg-white/[0.04] backdrop-blur-3xl border border-white/10 rounded-[2.5rem] p-10 space-y-10 shadow-2xl relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 p-8 pointer-events-none opacity-[0.03]">
                    <Layers size={120} />
                  </div>

                  <div className="flex justify-between items-end relative border-b border-white/5 pb-8">
                    <div className="space-y-2">
                      <span className="text-[11px] font-black text-[#faa916] uppercase tracking-[0.5em]">SYSTEM QUEUE</span>
                      <h4 className="text-4xl font-black text-white">{files.length} <span className="text-white/20 font-light text-2xl lowercase">ֆայլ</span></h4>
                    </div>
                    <button 
                      onClick={clearFiles}
                      className="p-4 rounded-2xl bg-red-500/5 hover:bg-red-500/10 text-red-500 transition-all border border-red-500/10 group"
                      title="Մաքրել բոլորը"
                    >
                      <Trash2 size={28} className="group-hover:rotate-12 transition-transform" />
                    </button>
                  </div>

                  <div className="space-y-4 relative">
                    <button 
                      onClick={processFiles}
                      disabled={isProcessing}
                      className="group relative w-full bg-[#faa916] text-black py-6 rounded-2xl font-black overflow-hidden transition-all hover:bg-white hover:shadow-[0_24px_48px_rgba(250,169,22,0.3)] disabled:opacity-50 active:scale-[0.98]"
                    >
                      <div className="relative flex items-center justify-center gap-4">
                        {isProcessing ? <Loader2 className="animate-spin" size={28} /> : <Zap size={28} fill="currentColor" />}
                        <span className="tracking-[0.2em] uppercase text-base font-black">{isProcessing ? 'Մշակվում է...' : 'ՍԿՍԵԼ ԴԱՍԱՎՈՐՈՒՄԸ'}</span>
                      </div>
                    </button>

                    <button 
                      onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                      className="w-full bg-white/5 border border-white/10 text-white/40 py-4 rounded-2xl font-mono text-[10px] uppercase tracking-[0.4em] flex items-center justify-center gap-4 hover:border-white/30 hover:text-white transition-all"
                    >
                      <ArrowUpDown size={16} />
                      {sortOrder === 'asc' ? 'ՀԻՆ → ՆՈՐ' : 'ՆՈՐ → ՀԻՆ'}
                    </button>
                  </div>

                  {isProcessing && (
                    <div className="space-y-4 pt-4 border-t border-white/5">
                      <div className="flex justify-between items-center font-mono text-[10px] text-white/30 uppercase tracking-[0.3em] px-1">
                        <span>Analysis Progress</span>
                        <span className="text-[#faa916] font-black">{Math.round(progress)}%</span>
                      </div>
                      <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                         <motion.div 
                          className="h-full bg-gradient-to-r from-[#faa916] via-white to-[#faa916] rounded-full shadow-[0_0_15px_rgba(250,169,22,0.5)]"
                          initial={{ width: 0 }}
                          animate={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Results Analytics Column */}
          <div className="xl:col-span-7 flex flex-col h-full overflow-hidden">
            <div className="bg-white/[0.015] backdrop-blur-3xl border border-white/5 rounded-[2.5rem] overflow-hidden shadow-[0_32px_64px_-16px_rgba(0,0,0,0.5)] flex flex-col h-full min-h-0">
              <div className="px-10 py-6 border-b border-white/[0.05] flex flex-col sm:flex-row sm:items-center justify-between gap-6 bg-white/[0.02] shrink-0">
                <div className="flex items-center gap-6">
                  <div className="bg-[#faa916]/10 p-3 rounded-2xl">
                    <FileText size={24} className="text-[#faa916]" />
                  </div>
                  <div>
                    <h2 className="text-[10px] font-mono uppercase tracking-[0.5em] text-white/30 mb-1">Interactive Stream</h2>
                    <p className="text-xl font-black text-white tracking-tight">Մշակման Արդյունքները</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 bg-black/20 p-2 rounded-2xl border border-white/5">
                  {[
                    { label: 'META', color: 'bg-zinc-500' },
                    { label: 'TEXT', color: 'bg-blue-500' },
                    { label: 'SMART', color: 'bg-white' },
                    { label: 'GEMINI', color: 'bg-amber-500' }
                  ].map(tag => (
                    <div key={tag.label} className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 rounded-xl transition-all cursor-default">
                      <div className={`w-1.5 h-1.5 rounded-full ${tag.color} shadow-[0_0_8px_currentColor]`} />
                      <span className="text-[9px] font-mono font-bold text-white/40 tracking-wider uppercase">{tag.label}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
                {results.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center p-8 opacity-20">
                    <div className="relative mb-4">
                       <FileText size={64} strokeWidth={0.5} />
                       <motion.div 
                        animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
                        transition={{ duration: 4, repeat: Infinity }}
                        className="absolute inset-0 flex items-center justify-center"
                       >
                         <BrainCircuit size={24} className="text-[#faa916]/50" />
                       </motion.div>
                    </div>
                    <p className="text-[10px] font-mono uppercase tracking-[0.5em] text-center max-w-xs leading-loose">
                      Վերբեռնեք փաստաթղթերը
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    <AnimatePresence mode="popLayout">
                      {sortedResults.map((res, idx) => (
                        <motion.div 
                          key={res.id}
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.98 }}
                          transition={{ duration: 0.3, delay: idx * 0.03 }}
                          className={`
                            relative transition-all duration-300 border-b border-white/[0.03] last:border-0
                            ${expandedId === res.id ? 'bg-white/[0.06] shadow-inner' : 'hover:bg-white/[0.03]'}
                          `}
                        >
                          <div 
                            className="px-8 py-5 flex items-center gap-5 cursor-pointer group"
                            onClick={() => setExpandedId(expandedId === res.id ? null : res.id)}
                          >
                            <div className="flex flex-col items-center gap-0.5 shrink-0">
                               <span className="text-[7px] font-mono text-white/20 font-bold tracking-tighter">POS</span>
                               <div className="text-[10px] font-mono text-white/40 group-hover:text-[#faa916] transition-colors font-bold">
                                 {String(idx + 1).padStart(2, '0')}
                               </div>
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <h4 className="text-xs font-bold text-white truncate mb-1 group-hover:translate-x-0.5 transition-all duration-300">
                                {res.name}
                              </h4>
                              <div className="flex items-center gap-3">
                                {res.status === 'success' && res.date ? (
                                  <div className="flex items-center gap-2">
                                    <div className="flex items-center gap-1.5 px-1.5 py-0.5 bg-white/5 rounded-md text-[#faa916] text-[9px] font-mono font-bold border border-[#faa916]/10">
                                      <Calendar size={10} />
                                      {formatDateDDMMYYYY(res.date)}
                                    </div>
                                    <div className={`text-[8px] px-1.5 py-0.5 rounded-sm font-black tracking-widest border ${
                                      res.method === 'gemini' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' : 
                                      res.method === 'smart' ? 'bg-white/10 text-white border-white/20' :
                                      res.method === 'text' ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' :
                                      'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                                    }`}>
                                      {res.method.toUpperCase()}
                                    </div>
                                  </div>
                                ) : res.status === 'processing' ? (
                                  <div className="flex items-center gap-1.5 text-amber-400 text-[8px] font-mono font-bold tracking-[0.2em] animate-pulse">
                                    <Loader2 size={8} className="animate-spin" />
                                    ANALYZING...
                                  </div>
                                ) : res.status === 'error' ? (
                                  <div className="flex items-center gap-1.5 text-red-500 text-[8px] font-mono font-bold tracking-[0.2em] px-1.5 py-0.5 bg-red-500/10 rounded-md border border-red-500/20">
                                    <AlertCircle size={10} />
                                    {res.error?.toUpperCase()}
                                  </div>
                                ) : (
                                  <div className="text-[8px] font-mono text-white/20 tracking-[0.3em] font-bold">QUEUED</div>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-3 shrink-0">
                               <button 
                                 onClick={(e) => { 
                                   e.stopPropagation(); 
                                   const fileToEdit = files.find(f => f.name === res.name);
                                   if (fileToEdit) setEditingFile(fileToEdit);
                                 }}
                                 className="flex items-center gap-1.5 text-[9px] px-4 py-2 rounded-lg bg-[#faa916] text-black hover:bg-white transition-all font-black shadow-xl shadow-[#faa916]/20 active:scale-95"
                               >
                                 <Pencil size={12} />
                                 Խմբագրել
                               </button>
                               <ChevronRight size={14} className={`text-white/20 transition-transform duration-500 ${expandedId === res.id ? 'rotate-90 text-[#faa916]' : 'group-hover:translate-x-1'}`} />
                            </div>
                          </div>

                          <AnimatePresence>
                            {expandedId === res.id && (
                              <motion.div 
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden bg-white/[0.01] border-t border-white/5"
                              >
                                <div className="px-8 py-6 space-y-6">
                                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                                    <div className="space-y-4">
                                      <h5 className="text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5 pb-2">Analysis</h5>
                                      
                                      {res.visualEvidence ? (
                                        <div 
                                          className="relative border border-white/5 rounded-2xl overflow-hidden bg-black/40 group p-1.5 cursor-pointer"
                                          onClick={() => setZoomedImage(res.visualEvidence!)}
                                        >
                                          <img 
                                            src={res.visualEvidence} 
                                            alt="Evidence" 
                                            className="w-full h-auto object-contain max-h-48 rounded-xl transition-transform duration-700 group-hover:scale-105"
                                            referrerPolicy="no-referrer"
                                          />
                                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center backdrop-blur-sm rounded-xl">
                                            <ZoomIn size={20} className="text-white" />
                                          </div>
                                        </div>
                                      ) : (
                                        <div className="bg-white/[0.02] p-6 rounded-2xl border border-white/5 flex flex-col items-center justify-center text-center gap-2">
                                          <FileWarning size={24} className="text-white/10" />
                                          <p className="text-[10px] text-white/30 font-medium">Ապացույցը բացակայում է</p>
                                        </div>
                                      )}

                                      <div className="space-y-3">
                                        {res.context && (
                                          <div className="bg-white/[0.02] p-4 rounded-xl border border-white/5 text-xs leading-relaxed text-white/70 italic">
                                            {res.context.split(/(\[ .*? \])/).map((part, i) => 
                                              part.startsWith('[ ') && part.endsWith(' ]') ? 
                                                <span key={i} className="text-[#faa916] font-black bg-[#faa916]/10 px-0.5 rounded">{part}</span> : 
                                                part
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>

                                    <div className="space-y-6">
                                      <div className="space-y-4">
                                        <h5 className="text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5 pb-2">Correction</h5>
                                        <div className="space-y-2">
                                          <label className="text-[9px] font-mono text-white/40 uppercase tracking-widest px-1">Correction Date</label>
                                          <div className="relative">
                                            <input 
                                              type="text" 
                                              placeholder="25-11-2025"
                                              defaultValue={res.date ? formatDateDDMMYYYY(res.date) : ''}
                                              onChange={(e) => handleManualDateChange(res.id, e.target.value)}
                                              className="w-full bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3 text-xs text-white focus:bg-white/[0.05] focus:border-[#faa916]/50 outline-none transition-all"
                                            />
                                            <div className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20">
                                               <Calendar size={14} />
                                            </div>
                                          </div>
                                        </div>
                                      </div>

                                      <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                                        <button 
                                          onClick={(e) => { e.stopPropagation(); setFeedbackDocId(res.id); }}
                                          className="group flex items-center gap-2 text-[9px] font-black text-white/40 hover:text-white transition-all uppercase tracking-widest"
                                        >
                                          <MessageSquareWarning size={12} className="text-red-500/50 group-hover:text-red-500" />
                                          Զեկուցել սխալի մասին
                                        </button>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </motion.div>
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #faa91644; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #96031aaa; }
      `}} />

      {/* Zoom Modal */}
      <AnimatePresence>
        {zoomedImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#1b1b1e]/95 backdrop-blur-md p-4 md:p-12"
            onClick={() => setZoomedImage(null)}
          >
            <button 
              className="absolute top-6 right-6 text-[#fbfffe]/50 hover:text-[#fbfffe] transition-colors bg-black/50 p-2 rounded-full"
              onClick={() => setZoomedImage(null)}
            >
              <X size={24} />
            </button>
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative max-w-5xl w-full max-h-full flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative bg-white p-2 md:p-4 rounded-xl shadow-2xl border border-white/10 w-full overflow-hidden">
                <TransformWrapper
                  initialScale={1}
                  minScale={0.5}
                  maxScale={5}
                  centerOnInit
                >
                  {({ zoomIn, zoomOut, resetTransform }) => (
                    <>
                      <div className="absolute top-6 right-6 z-10 flex flex-col gap-2 bg-black/50 p-2 rounded-lg backdrop-blur-md">
                        <button onClick={() => zoomIn()} className="text-white hover:text-[#faa916] transition-colors p-1">+</button>
                        <button onClick={() => zoomOut()} className="text-white hover:text-[#faa916] transition-colors p-1">-</button>
                        <button onClick={() => resetTransform()} className="text-white hover:text-[#faa916] transition-colors p-1 text-xs font-mono">R</button>
                      </div>
                      <TransformComponent wrapperStyle={{ width: "100%", height: "80vh" }}>
                        <img 
                          src={zoomedImage} 
                          alt="Zoomed Evidence" 
                          className="w-full h-auto object-contain rounded-lg"
                          referrerPolicy="no-referrer"
                        />
                      </TransformComponent>
                    </>
                  )}
                </TransformWrapper>
                <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-[#faa916] -translate-x-2 -translate-y-2" />
                <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-[#faa916] translate-x-2 -translate-y-2" />
                <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-[#faa916] -translate-x-2 translate-y-2" />
                <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-[#faa916] translate-x-2 translate-y-2" />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Feedback Modal */}
      <AnimatePresence>
        {feedbackDocId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#1b1b1e]/80 backdrop-blur-sm p-4"
            onClick={() => setFeedbackDocId(null)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 10 }}
              className="bg-[#1b1b1e] border border-[#fbfffe]/10 rounded-2xl p-6 max-w-md w-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-[#fbfffe] font-medium flex items-center gap-2">
                  <MessageSquareWarning size={18} className="text-[#faa916]" />
                  Զեկուցել սխալի մասին
                </h3>
                <button onClick={() => setFeedbackDocId(null)} className="text-[#fbfffe]/60 hover:text-[#fbfffe]">
                  <X size={20} />
                </button>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-[#fbfffe]/60 mb-1">Իրական ամսաթիվը (Expected Date)</label>
                  <input 
                    type="text" 
                    value={feedbackExpectedDate}
                    onChange={(e) => setFeedbackExpectedDate(e.target.value)}
                    placeholder="օր. 25-11-2025"
                    className="w-full bg-[#1b1b1e]/40 border border-[#fbfffe]/10 rounded-lg px-3 py-2 text-sm text-[#fbfffe] focus:border-[#faa916] outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#fbfffe]/60 mb-1">Մեկնաբանություն (Comments - optional)</label>
                  <textarea 
                    value={feedbackComments}
                    onChange={(e) => setFeedbackComments(e.target.value)}
                    placeholder="Նշեք, թե որտեղ էր գտնվում ճիշտ ամսաթիվը..."
                    className="w-full bg-[#1b1b1e]/40 border border-[#fbfffe]/10 rounded-lg px-3 py-2 text-sm text-[#fbfffe] focus:border-[#faa916] outline-none h-24 resize-none"
                  />
                </div>
                
                <div className="pt-4 flex justify-end gap-3">
                  <button 
                    onClick={() => setFeedbackDocId(null)}
                    className="px-4 py-2 rounded-lg text-sm text-[#fbfffe]/60 hover:text-[#fbfffe] transition-colors"
                  >
                    Չեղարկել
                  </button>
                  <button 
                    onClick={() => submitFeedback(feedbackDocId)}
                    disabled={isSubmittingFeedback}
                    className="px-4 py-2 rounded-lg text-sm bg-[#faa916] text-[#1b1b1e] font-bold hover:bg-[#faa916]/80 transition-colors disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSubmittingFeedback ? <Loader2 size={14} className="animate-spin" /> : null}
                    {user ? 'Ուղարկել (Submit)' : 'Մուտք Google-ով և Ուղարկել'}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor Modal */}
      <AnimatePresence>
        {editingFile && (
          <PdfEditor 
            file={editingFile} 
            onClose={() => setEditingFile(null)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}
