import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SkillDetail, SkillInfo } from '../types/skill';
import Markdown from './Markdown';
import ConfirmModal from './ConfirmModal';
import Button from './ui/button';
import PageHeader from './ui/page-header';
import { ActionTooltip } from './ui/tooltip';
import { Dialog, DialogContent } from './ui/dialog';

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
    <div className="page-layout pt-4">
      {/* 标题栏 */}
      <PageHeader
        title="Skill 管理"
        description={<><code className="font-mono text-[12px]">~/.agents/skills</code> · Codex 读取的 Skill 目录</>}
        actions={
          <Button
            size="sm"
            onClick={() => {
              setIsAddOpen(true);
              setAddError(null);
              setAddPath('');
            }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>
            添加 Skill
          </Button>
        }
      />

      {error && (
        <div className="mb-4 shrink-0 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-2.5 text-[12px] text-destructive">
          {error}
        </div>
      )}

      {/* 内容区 */}
      <div className="page-scroll">
        {isLoading ? (
          <div className="grid grid-cols-1 @min-[640px]/page:grid-cols-2 @min-[1024px]/page:grid-cols-3 @min-[1400px]/page:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-28 bg-muted/50 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : skills.length === 0 ? (
          <div className="rounded-xl border border-dashed py-16 px-8 text-center">
            <p className="text-[13px] text-muted-foreground">~/.agents/skills 下暂无 Skill，点击右上角添加</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 @min-[640px]/page:grid-cols-2 @min-[1024px]/page:grid-cols-3 @min-[1400px]/page:grid-cols-4 gap-4">
            {skills.map(skill => (
              <div
                key={skill.name}
                onClick={() => void openDetail(skill.dirName)}
                className="group relative min-w-0 bg-card rounded-xl border shadow-xs hover:bg-accent/40 transition-colors p-4 cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 shrink-0 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 4 5 5L7 22l-5-5Z"/><path d="m14 5 5 5"/><path d="M6 13l5 5"/><path d="M19 2v3"/><path d="M22 5h-3"/></svg>
                    </div>
                    <h3 className="min-w-0 truncate text-[14px] font-medium text-foreground">
                      {skill.name}
                    </h3>
                    {skill.isSymlink && (
                      <span className="shrink-0 rounded-md bg-muted border border-border px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                        链接
                      </span>
                    )}
                  </div>
                  <ActionTooltip label="删除 Skill">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        setDeleteName(skill.dirName);
                      }}
                      aria-label="删除 Skill"
                      className="w-7 h-7 shrink-0 flex items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive transition-all"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                    </button>
                  </ActionTooltip>
                </div>
                <p className="text-[12px] text-muted-foreground leading-relaxed line-clamp-2 min-h-[32px]">
                  {skill.description || '（无描述）'}
                </p>
                <p className="mt-2 truncate text-[11px] font-mono text-muted-foreground/70">{skill.path}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 详情弹窗 */}
      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="max-w-2xl p-0 max-h-[82vh] flex flex-col overflow-hidden gap-0" showCloseButton={false}>
          <div className="px-6 py-4 border-b border-border flex items-start justify-between gap-4 shrink-0">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[15px] text-foreground tracking-tight">{detail?.name}</h3>
                {detail?.isSymlink && (
                  <span className="rounded-md bg-muted border border-border px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">链接</span>
                )}
              </div>
              <p className="mt-1 text-[11px] font-mono text-muted-foreground truncate">{detail?.path}</p>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setDetail(null)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="关闭"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
            </Button>
          </div>
          <div className="px-6 py-2 bg-muted/40 border-b text-[11.5px] text-muted-foreground shrink-0">
            {detail?.fileCount} 个文件
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
            {detail && <Markdown content={detail.content} />}
          </div>
        </DialogContent>
      </Dialog>

      {detailLoading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/10">
          <div className="bg-popover rounded-lg shadow-lg border px-5 py-4 flex items-center gap-2.5 text-[13px] text-muted-foreground">
            <svg className="animate-spin" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
            加载详情中...
          </div>
        </div>
      )}

      {/* 添加弹窗 */}
      <Dialog open={isAddOpen} onOpenChange={(open) => { if (!open) setIsAddOpen(false); }}>
        <DialogContent className="max-w-md p-0 overflow-hidden gap-0" showCloseButton={false}>
          <div className="px-5 py-4 border-b border-border">
            <h3 className="font-semibold text-[15px] text-foreground tracking-tight">添加 Skill</h3>
          </div>
          <div className="p-5 flex flex-col gap-4">
            <div className="text-[12px] text-muted-foreground leading-relaxed">
              输入包含 <code className="font-mono text-foreground">SKILL.md</code> 的本地目录路径，
              将复制到 <code className="font-mono">~/.agents/skills/</code>。
            </div>
            <input
              value={addPath}
              onChange={e => {
                setAddPath(e.target.value);
                setAddError(null);
              }}
              placeholder="例如：/Users/you/projects/my-skill"
              className="h-9 w-full px-3 bg-background border border-input rounded-md shadow-xs focus:border-neutral-700 outline-none transition-[color,box-shadow] text-[13px] font-mono text-foreground placeholder:text-muted-foreground"
            />
            {addError && (
              <div className="rounded-md bg-destructive/5 border border-destructive/20 px-3 py-2 text-[12px] text-destructive break-all">
                {addError}
              </div>
            )}
          </div>
          <div className="px-5 py-3 bg-muted/40 border-t flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddOpen(false)}
              disabled={isAdding}
            >
              取消
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleAdd()}
              disabled={isAdding}
              className="min-w-[88px]"
            >
              {isAdding && (
                <svg className="animate-spin mr-1.5" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>
              )}
              {isAdding ? '添加中...' : '添加'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
