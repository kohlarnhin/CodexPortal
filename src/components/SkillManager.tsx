import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SkillDetail, SkillInfo } from '../types/skill';
import Markdown from './Markdown';
import ConfirmModal from './ConfirmModal';

const SkillManager: React.FC = () => {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addPath, setAddPath] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [deleteName, setDeleteName] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const data = await invoke<SkillInfo[]>('list_skills');
      setSkills(data);
    } catch (err: any) {
      setError(err?.toString() || '加载 Skill 列表失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetail = async (name: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const data = await invoke<SkillDetail>('get_skill_detail', { name });
      setDetail(data);
    } catch (err: any) {
      setError(err?.toString() || '加载 Skill 详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleAdd = async () => {
    const path = addPath.trim();
    if (!path) {
      setAddError('请输入源目录路径');
      return;
    }
    setIsAdding(true);
    setAddError(null);
    try {
      await invoke<SkillInfo>('add_skill', { sourcePath: path });
      setIsAddOpen(false);
      setAddPath('');
      void load();
    } catch (err: any) {
      setAddError(err?.toString() || '添加失败');
    } finally {
      setIsAdding(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteName) return;
    setIsDeleting(true);
    try {
      await invoke('delete_skill', { name: deleteName });
      setDeleteName(null);
      void load();
    } catch (err: any) {
      setError(err?.toString() || '删除失败');
      setDeleteName(null);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto w-full h-full flex flex-col pt-4">
      {/* 标题栏 */}
      <div className="flex items-center justify-between gap-4 mb-4 shrink-0">
        <div className="min-w-0">
          <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">Skill 管理</h2>
          <p className="text-[13px] text-[#999999]">~/.agents/skills · Codex 读取的 Skill 目录</p>
        </div>
        <button
          onClick={() => {
            setIsAddOpen(true);
            setAddError(null);
            setAddPath('');
          }}
          className="flex items-center gap-2 px-4 py-1.5 bg-black hover:bg-[#333333] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
          添加 Skill
        </button>
      </div>

      {error && (
        <div className="mb-4 shrink-0 rounded-lg border border-[#F3D1D1] bg-[#FFF5F5] px-4 py-2.5 text-[12px] text-[#B3261E]">
          {error}
        </div>
      )}

      {/* 内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto -mr-4 pr-4">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 bg-white border border-[#EAEAEA] rounded-xl animate-pulse" />
            ))}
          </div>
        ) : skills.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#EAEAEA] py-16 px-8 text-center">
            <p className="text-[13px] text-[#999999]">~/.agents/skills 下暂无 Skill，点击右上角添加</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {skills.map(skill => (
              <div
                key={skill.name}
                onClick={() => void openDetail(skill.name)}
                className="group relative bg-white rounded-xl border border-[#EAEAEA] hover:border-[#C8C8C8] hover:shadow-sm transition-all p-5 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 shrink-0 rounded-lg bg-[#F5F5F5] border border-[#EAEAEA] flex items-center justify-center text-[#777777] group-hover:bg-black group-hover:text-white group-hover:border-black transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 4 5 5L7 22l-5-5Z"/><path d="m14 5 5 5"/><path d="M6 13l5 5"/><path d="M19 2v3"/><path d="M22 5h-3"/></svg>
                    </div>
                    <h3 className="min-w-0 truncate text-[15px] font-semibold text-black tracking-tight">
                      {skill.name}
                    </h3>
                    {skill.isSymlink && (
                      <span className="shrink-0 rounded-full bg-[#F5F5F5] border border-[#EAEAEA] px-2 py-0.5 text-[10px] font-medium text-[#888888]">
                        链接
                      </span>
                    )}
                  </div>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      setDeleteName(skill.name);
                    }}
                    title="删除 Skill"
                    className="w-7 h-7 shrink-0 flex items-center justify-center rounded text-[#BBBBBB] opacity-0 group-hover:opacity-100 hover:bg-[#FFF0F0] hover:text-[#D32F2F] transition-all"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  </button>
                </div>
                <p className="text-[12px] text-[#666666] leading-relaxed line-clamp-2 min-h-[32px]">
                  {skill.description || '（无描述）'}
                </p>
                <p className="mt-2 truncate text-[10px] font-mono text-[#AAAAAA]">{skill.path}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 详情弹窗 */}
      {detail && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in" onClick={() => setDetail(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl border border-[#EAEAEA] w-full max-w-2xl max-h-[82vh] flex flex-col overflow-hidden animate-modal-in">
            <div className="px-6 py-4 border-b border-[#EAEAEA] flex items-start justify-between gap-4 shrink-0">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-[15px] text-black tracking-tight">{detail.name}</h3>
                  {detail.isSymlink && (
                    <span className="rounded-full bg-[#F5F5F5] border border-[#EAEAEA] px-2 py-0.5 text-[10px] font-medium text-[#888888]">链接</span>
                  )}
                </div>
                <p className="mt-1 text-[11px] font-mono text-[#888888] truncate">{detail.path}</p>
              </div>
              <button
                onClick={() => setDetail(null)}
                className="w-7 h-7 shrink-0 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
              </button>
            </div>
            <div className="px-6 py-3 bg-[#F9F9F9] border-b border-[#EAEAEA] text-[11px] text-[#999999] shrink-0">
              {detail.fileCount} 个文件
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
              <Markdown content={detail.content} />
            </div>
          </div>
        </div>
      )}

      {detailLoading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/10">
          <div className="bg-white rounded-xl shadow-2xl border border-[#EAEAEA] px-6 py-5 flex items-center gap-2.5 text-[13px] text-[#666666]">
            <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            加载详情中...
          </div>
        </div>
      )}

      {/* 添加弹窗 */}
      {isAddOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm animate-fade-in" onClick={() => setIsAddOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl border border-[#EAEAEA] w-full max-w-md overflow-hidden animate-modal-in">
            <div className="px-5 py-4 border-b border-[#EAEAEA]">
              <h3 className="font-semibold text-[15px] text-black tracking-tight">添加 Skill</h3>
            </div>
            <div className="p-5 flex flex-col gap-4">
              <div className="text-[12px] text-[#666666] leading-relaxed">
                输入包含 <code className="font-mono text-black">SKILL.md</code> 的本地目录路径，
                将复制到 <code className="font-mono">~/.agents/skills/</code>。
              </div>
              <input
                value={addPath}
                onChange={e => {
                  setAddPath(e.target.value);
                  setAddError(null);
                }}
                placeholder="例如：/Users/you/projects/my-skill"
                className="w-full px-3 py-2 bg-white border border-[#EAEAEA] rounded-md focus:border-black focus:ring-1 focus:ring-black outline-none transition-all text-[13px] font-mono text-black placeholder-[#A0A0A0]"
              />
              {addError && (
                <div className="rounded-md bg-[#FFF0F0] border border-[#FFD0D0] px-3 py-2 text-[12px] text-[#D32F2F] break-all">
                  {addError}
                </div>
              )}
            </div>
            <div className="px-5 py-3 bg-[#FAFAFA] border-t border-[#EAEAEA] flex items-center justify-end gap-2">
              <button
                onClick={() => setIsAddOpen(false)}
                disabled={isAdding}
                className="px-4 py-1.5 text-[13px] font-medium text-[#666666] hover:bg-[#F0F0F0] hover:text-black rounded-md transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => void handleAdd()}
                disabled={isAdding}
                className="min-w-[88px] px-4 py-1.5 bg-black hover:bg-[#333333] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {isAdding && (
                  <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
                )}
                {isAdding ? '添加中...' : '添加'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={deleteName !== null}
        title="删除 Skill"
        message={`确定删除 Skill "${deleteName}" 吗？将同时删除 ~/.agents/skills/${deleteName} 目录。`}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteName(null)}
      />
    </div>
  );
};

export default SkillManager;
