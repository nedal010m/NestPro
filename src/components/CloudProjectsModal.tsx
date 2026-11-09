import React, { useState } from "react";
import {
  CheckCircle2,
  Cloud,
  CloudUpload,
  FolderOpen,
  HardDrive,
  LogIn,
  LogOut,
  PlusCircle,
  Trash2,
  X,
} from "lucide-react";
import type { User } from "firebase/auth";
import type { CloudProjectRecord } from "../lib/firebase";

interface CloudProjectsModalProps {
  onClose: () => void;
  user: User | null;
  projectName: string;
  onChangeProjectName: (name: string) => void;
  projects: CloudProjectRecord[];
  activeProjectId: string | null;
  saving: boolean;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onSaveCurrent: (asNew?: boolean) => Promise<void>;
  onLoadProject: (proj: CloudProjectRecord) => void;
  onDeleteProject: (projId: string) => Promise<void>;
}

export default function CloudProjectsModal({
  onClose,
  user,
  projectName,
  onChangeProjectName,
  projects,
  activeProjectId,
  saving,
  onSignIn,
  onSignOut,
  onSaveCurrent,
  onLoadProject,
  onDeleteProject,
}: CloudProjectsModalProps) {
  const [authError, setAuthError] = useState<string | null>(null);

  const handleSignIn = async () => {
    setAuthError(null);
    try {
      await onSignIn();
    } catch (e) {
      setAuthError((e as Error).message || "تعذر تسجيل الدخول عبر Google");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
    >
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0a1120] text-slate-100 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <h2 id="cloud-modal-title" className="text-base font-extrabold text-white">
                السحابة والمشاريع المحفوظة (Cloud Workspace)
              </h2>
              <p className="text-xs text-slate-400">
                احفظ مشاريع التعشيق والقطع ومقاسات الألواح على السحابة لتفتحها من أي جهاز وفي أي وقت
              </p>
            </div>
          </div>
          <button
            type="button"
            aria-label="إغلاق نافذة السحابة"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-800/80 p-1.5 text-slate-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Account Status Banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-[#070c18] px-5 py-3">
          {user ? (
            <div className="flex items-center gap-2.5 text-xs">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <div>
                <span className="font-bold text-white">
                  متصل بالسحابة: {user.displayName || user.email}
                </span>
                <span className="mr-2 text-slate-400 font-mono" dir="ltr">
                  ({user.email})
                </span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-slate-300">
              <HardDrive className="h-4 w-4 text-amber-400 shrink-0" />
              <span>
                وضع الحفظ المحلي نشط حالياً — سجّل الدخول بحساب Google لمزامنة مشاريعك عبر جميع أجهزتك.
              </span>
            </div>
          )}

          {user ? (
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-slate-700 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>تسجيل الخروج</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSignIn()}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-extrabold text-slate-950 hover:bg-emerald-400"
            >
              <LogIn className="h-3.5 w-3.5" />
              <span>تسجيل الدخول عبر Google للمزامنة السحابية</span>
            </button>
          )}
        </div>

        {authError && (
          <div className="bg-rose-500/10 px-5 py-2 text-xs text-rose-300 border-b border-rose-500/20">
            {authError}
          </div>
        )}

        {/* Save Current Project Bar */}
        <div className="border-b border-slate-800 bg-[#0b1324] px-5 py-3.5">
          <label className="mb-1.5 block text-xs font-bold text-slate-300">
            حفظ المشروع الحالي في السحابة
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={projectName}
              maxLength={120}
              onChange={(e) => onChangeProjectName(e.target.value)}
              placeholder="اسم المشروع (مثال: طلبية يافطات أكريليك - عميل 14)"
              className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-[#060a12] px-3 py-2 text-xs text-white outline-none focus:border-emerald-400"
            />
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSaveCurrent(false)}
              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-extrabold text-slate-950 hover:bg-emerald-400 disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <CloudUpload className="h-4 w-4" />
              <span>{saving ? "جارٍ الحفظ..." : activeProjectId ? "تحديث المشروع" : "حفظ المشروع الآن"}</span>
            </button>
            {activeProjectId && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void onSaveCurrent(true)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50 whitespace-nowrap shrink-0"
              >
                <PlusCircle className="h-3.5 w-3.5 text-cyan-400" />
                <span>حفظ كنسخة جديدة</span>
              </button>
            )}
          </div>
        </div>

        {/* Saved Projects List */}
        <div className="flex-1 overflow-y-auto p-5">
          <h3 className="mb-3 text-xs font-bold text-slate-300">
            المشاريع المحفوظة ({projects.length})
          </h3>

          {projects.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center">
              <FolderOpen className="mx-auto mb-2 h-8 w-8 text-slate-500" />
              <p className="text-xs font-semibold text-slate-300">
                لا توجد مشاريع محفوظة حتى الآن
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                اكتب اسم المشروع بالأعلى واضغط «حفظ المشروع الآن» للرجوع إليه من أي مكان وفي أي وقت.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((proj) => {
                const isCurrent = proj.id === activeProjectId;
                const dateStr = new Date(proj.updatedAtMs).toLocaleString("ar-EG", {
                  dateStyle: "medium",
                  timeStyle: "short",
                });

                return (
                  <div
                    key={proj.id}
                    className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border p-3 transition-colors ${
                      isCurrent
                        ? "border-emerald-500/60 bg-emerald-950/15"
                        : "border-slate-800 bg-[#070c17] hover:border-slate-700"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-bold text-white">
                          {proj.name}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          · {proj.isLocalOnly ? "محفوظ محلياً" : "سحابي متزامن"}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400 font-mono tabular-nums">
                        <span dir="ltr">
                          اللوح: {proj.sheetW}×{proj.sheetH} mm
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{proj.partsCount} قطعة</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-400">
                          كفاءة {proj.efficiency.toFixed(1)}%
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{dateStr}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          onLoadProject(proj);
                          onClose();
                        }}
                        className="flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500 hover:text-slate-950 transition-colors"
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        <span>فتح المشروع</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`حذف مشروع ${proj.name}`}
                        onClick={() => void onDeleteProject(proj.id)}
                        className="rounded-lg border border-slate-800 bg-slate-900 p-1.5 text-slate-400 hover:border-rose-500/40 hover:text-rose-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
