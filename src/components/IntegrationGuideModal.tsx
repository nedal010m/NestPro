import React, { useState } from "react";
import { Check, Copy, Download, FileCode, Sparkles, Terminal, X } from "lucide-react";
import {
  buildCorelApplyMacro,
  buildCorelExportMacro,
  buildCorelOneClickVBS,
} from "../lib/corel";
import { buildApplyScript, buildIllustratorExportScript } from "../lib/jsx";
import { download } from "../lib/exporters";
import type { NestSettings, NestSnapshot, Shape } from "../lib/types";

interface IntegrationGuideModalProps {
  onClose: () => void;
  shapes: Shape[];
  snap: NestSnapshot | null;
  st: NestSettings;
  cleanTags: boolean;
  initialTab?: "corel" | "illustrator";
}

export default function IntegrationGuideModal({
  onClose,
  shapes,
  snap,
  st,
  cleanTags,
  initialTab = "corel",
}: IntegrationGuideModalProps) {
  const [tab, setTab] = useState<"corel" | "illustrator">(initialTab);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const corelExportCode = buildCorelExportMacro();
  const corelApplyCode = snap
    ? buildCorelApplyMacro(shapes, snap, st, cleanTags)
    : "' قم بتشغيل التعشيق أولاً لتوليد كود التطبيق المباشر على اللوح الخام داخل CorelDRAW";

  const aiExportCode = buildIllustratorExportScript();
  const aiApplyCode = snap
    ? buildApplyScript(shapes, snap, st, cleanTags)
    : "// قم بتشغيل التعشيق أولاً لتوليد سكريبت التطبيق المباشر داخل Illustrator";

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2500);
    } catch {
      // Fallback
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="integration-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0a1120] text-slate-100 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <FileCode className="h-5 w-5" />
            </div>
            <div>
              <h2 id="integration-modal-title" className="text-base font-extrabold text-white">
                مركز الربط المباشر مع CorelDRAW و Adobe Illustrator
              </h2>
              <p className="text-xs text-slate-400">
                تصدير واستيراد الأشكال وتطبيق التعشيق تلقائياً بالمليمتر الحقيقي مع فصل طبقات القص الداخلي والخارجي
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="إغلاق نافذة الربط"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800/80 p-1.5 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Host Tabs */}
        <div className="flex gap-2 border-b border-slate-800 bg-[#070c18] px-5 py-2.5">
          <button
            type="button"
            onClick={() => setTab("corel")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              tab === "corel"
                ? "bg-emerald-500 text-slate-950 shadow-md shadow-emerald-950/50"
                : "bg-slate-800/70 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <span>🟢 الربط الاحترافي مع CorelDRAW (X7 – 2026)</span>
          </button>
          <button
            type="button"
            onClick={() => setTab("illustrator")}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors ${
              tab === "illustrator"
                ? "bg-amber-500 text-slate-950 shadow-md shadow-amber-950/50"
                : "bg-slate-800/70 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <span>🟠 الربط مع Adobe Illustrator (CC – 2026)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs leading-relaxed">
          {tab === "corel" ? (
            <>
              {/* Highlighted One-Click VBS Automation */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                      <Sparkles className="h-4 w-4" />
                      <span>الطريقة السريعة (بدون تثبيت ماكرو): الإرسال بضغطة واحدة عبر COM (.vbs)</span>
                    </h3>
                    <p className="mt-1 text-slate-300">
                      يدعم CorelDRAW على ويندوز التشغيل التلقائي المباشر. بعد انتهاء التعشيق، حمّل ملف{" "}
                      <code className="text-emerald-300">NestPro_RunInCorel.vbs</code> وشغّله بنقرة مزدوجة، وسيقوم البرنامج بفتح أو استخدام نافذة CorelDRAW الحالية ورسم الألواح والقطع المعشّقة فوراً!
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!snap}
                    onClick={() =>
                      snap &&
                      download(
                        "NestPro_RunInCorel.vbs",
                        buildCorelOneClickVBS(shapes, snap, st),
                        "text/vbscript"
                      )
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 disabled:opacity-40 whitespace-nowrap shrink-0"
                  >
                    <Download className="h-4 w-4" />
                    <span>تحميل أداة الإرسال الفوري (.vbs)</span>
                  </button>
                </div>
              </div>

              {/* Step-by-Step VBA Macro Bridge */}
              <div className="grid gap-4 lg:grid-cols-2">
                {/* Export Macro */}
                <div className="rounded-xl border border-slate-800 bg-[#070c17] p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="font-bold text-white">
                      1. ماكرو تصدير القطع من CorelDRAW (VBA)
                    </h4>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => copyText("corel_exp", corelExportCode)}
                        className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                      >
                        {copiedKey === "corel_exp" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>{copiedKey === "corel_exp" ? "تم النسخ" : "نسخ الكود"}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          download("NestPro_Corel_Export.bas", corelExportCode, "text/plain")
                        }
                        className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>.bas</span>
                      </button>
                    </div>
                  </div>
                  <p className="mb-2 text-[11px] text-slate-400">
                    داخل CorelDRAW اضغط <kbd className="rounded bg-slate-800 px-1.5 py-0.5 font-mono">Alt + F11</kbd> لفتح محرر الماكرو، الصق هذا الكود في <code className="text-slate-200">GlobalMacros</code>، حدد القطع واضغط تشغيل ليحفظ ملف <code className="text-emerald-300">NestPro_Corel_Export.json</code> على سطح المكتب مع حفظ الهوية الأصلية لكل شكل (<code className="text-slate-300">StaticID</code>).
                  </p>
                  <pre
                    dir="ltr"
                    className="max-h-48 overflow-auto rounded-lg border border-slate-800/90 bg-[#04070e] p-2.5 text-[11px] text-emerald-300/90 font-mono"
                  >
                    {corelExportCode}
                  </pre>
                </div>

                {/* Apply Macro */}
                <div className="rounded-xl border border-slate-800 bg-[#070c17] p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="font-bold text-white">
                      2. ماكرو تطبيق التعشيق داخل CorelDRAW (VBA)
                    </h4>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={!snap}
                        onClick={() => copyText("corel_app", corelApplyCode)}
                        className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                      >
                        {copiedKey === "corel_app" ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        <span>{copiedKey === "corel_app" ? "تم النسخ" : "نسخ الكود"}</span>
                      </button>
                      <button
                        type="button"
                        disabled={!snap}
                        onClick={() =>
                          snap &&
                          download("NestPro_Corel_Apply.bas", corelApplyCode, "text/plain")
                        }
                        className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-emerald-500 disabled:opacity-40"
                      >
                        <Download className="h-3.5 w-3.5" />
                        <span>.bas</span>
                      </button>
                    </div>
                  </div>
                  <p className="mb-2 text-[11px] text-slate-400">
                    ينشئ هذا الماكرو3 طبقات منظمة داخل CorelDRAW: طبقة اللوح الخام (<code className="text-slate-300">NestPro_Sheets</code>)، وطبقة الفتحات الداخلية باللون الأزرق Hairline (<code className="text-blue-400">NestPro_Inner_Cut</code>)، وطبقة القطع الخارجي باللون الأحمر Hairline (<code className="text-rose-400">NestPro_Outer_Cut</code>)، مع استنساخ وتدوير العناصر الأصلية بدقة.
                  </p>
                  <pre
                    dir="ltr"
                    className="max-h-48 overflow-auto rounded-lg border border-slate-800/90 bg-[#04070e] p-2.5 text-[11px] text-cyan-300/90 font-mono"
                  >
                    {corelApplyCode}
                  </pre>
                </div>
              </div>
            </>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {/* Illustrator Export Script */}
              <div className="rounded-xl border border-slate-800 bg-[#070c17] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-bold text-white">
                    1. سكريبت التصدير من Illustrator (.jsx)
                  </h4>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => copyText("ai_exp", aiExportCode)}
                      className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700"
                    >
                      {copiedKey === "ai_exp" ? (
                        <Check className="h-3.5 w-3.5 text-amber-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span>{copiedKey === "ai_exp" ? "تم النسخ" : "نسخ"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        download("NestPro_AI_Export.jsx", aiExportCode, "application/javascript")
                      }
                      className="flex items-center gap-1 rounded bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-amber-400"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>تحميل .jsx</span>
                    </button>
                  </div>
                </div>
                <p className="mb-2 text-[11px] text-slate-400">
                  حدد العناصر في Illustrator ثم اختر <code className="text-amber-300">File &gt; Scripts &gt; Other Script</code> وشغّل الملف ليحفظ <code className="text-slate-200">NestPro_AI_Export.json</code> على سطح المكتب.
                </p>
                <pre
                  dir="ltr"
                  className="max-h-56 overflow-auto rounded-lg border border-slate-800/90 bg-[#04070e] p-2.5 text-[11px] text-amber-300/90 font-mono"
                >
                  {aiExportCode}
                </pre>
              </div>

              {/* Illustrator Apply Script */}
              <div className="rounded-xl border border-slate-800 bg-[#070c17] p-4">
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-bold text-white">
                    2. سكريبت التطبيق داخل Illustrator (.jsx)
                  </h4>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={!snap}
                      onClick={() => copyText("ai_app", aiApplyCode)}
                      className="flex items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                    >
                      {copiedKey === "ai_app" ? (
                        <Check className="h-3.5 w-3.5 text-amber-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span>{copiedKey === "ai_app" ? "تم النسخ" : "نسخ"}</span>
                    </button>
                    <button
                      type="button"
                      disabled={!snap}
                      onClick={() =>
                        snap &&
                        download("NestPro_AI_Apply.jsx", aiApplyCode, "application/javascript")
                      }
                      className="flex items-center gap-1 rounded bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-slate-950 hover:bg-amber-400 disabled:opacity-40"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>تحميل .jsx</span>
                    </button>
                  </div>
                </div>
                <p className="mb-2 text-[11px] text-slate-400">
                  يستنسخ العناصر الأصلية بجميع ألوانها وتأثيراتها أو يرسم المسارات على طبقة جديدة داخل Illustrator.
                </p>
                <pre
                  dir="ltr"
                  className="max-h-56 overflow-auto rounded-lg border border-slate-800/90 bg-[#04070e] p-2.5 text-[11px] text-amber-200/90 font-mono"
                >
                  {aiApplyCode}
                </pre>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-[#070c18] px-5 py-3 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <Terminal className="h-4 w-4 text-emerald-400" />
            <span>
              نصيحة: يمكنك أيضاً تصدير ملف <strong>DXF</strong> أو <strong>SVG</strong> مباشرة وسحبه داخل CorelDRAW بدون أي ماكرو!
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-1.5 font-bold text-white hover:bg-slate-700"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}
