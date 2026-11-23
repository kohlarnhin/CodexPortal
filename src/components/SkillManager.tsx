import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { SkillDetail, SkillInfo } from '../types/skill';
import Markdown from './Markdown';
import ConfirmModal from './ConfirmModal';
import Button from './ui/button';
import Input from './ui/input';
import PageHeader from './ui/page-header';
import { ActionTooltip } from './ui/tooltip';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { LoaderCircle, Plus, Trash2, WandSparkles } from 'lucide-react';

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
    <div className="page-layout">
      <PageHeader
        title="Skill 管理"
        badge={
          <code className="font-mono text-[12px] text-[var(--label)]">
            ~/.agents/skills{skills.length > 0 ? ` · ${skills.length} 项` : ''}
          </code>
        }
        actions={
          <Button
            size="sm"
            onClick={() => {
              setIsAddOpen(true);
              setAddError(null);
              setAddPath('');
            }}
          >
            <Plus size={14} />
            添加 Skill
          </Button>
        }
      />

      {error && (
        <div className="mb-3 shrink-0 px-[var(--workspace-inset-inline)]">
          <div className="bento-card px-4 py-2.5 text-label text-destructive">{error}</div>
        </div>
      )}

      <div className="page-scroll flex flex-col">
        {isLoading ? (
          <div className="grid grid-cols-1 @min-[640px]/page:grid-cols-2 @min-[1160px]/page:grid-cols-3 gap-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-[152px] rounded-[14px] bg-[var(--button-fill)]/70 animate-pulse" />
            ))}
          </div>
        ) : skills.length === 0 ? (
          <div className="bento-empty flex-1 py-16">
            <div className="mb-3.5 grid size-11 place-items-center rounded-[12px] bg-[var(--button-fill)] text-muted-foreground">
              <WandSparkles size={20} />
            </div>
            <p className="text-body text-muted-foreground">~/.agents/skills 下暂无 Skill，点击右上角添加。</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 @min-[640px]/page:grid-cols-2 @min-[1160px]/page:grid-cols-3 gap-4">
            {skills.map(skill => (
              <div
                key={skill.name}
                onClick={() => void openDetail(skill.dirName)}
                className="bento-card group relative flex min-h-[152px] min-w-0 cursor-pointer flex-col overflow-hidden transition-colors hover:bg-[var(--hover)]"
              >
                <div className="flex flex-1 flex-col px-5 pt-5 pb-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="grid size-10 shrink-0 place-items-center rounded-[10px] bg-[var(--button-fill)] text-muted-foreground">
                        <WandSparkles size={17} />
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <h3 className="min-w-0 truncate text-title font-semibold tracking-[-0.01em] text-foreground">
                          {skill.name}
                        </h3>
                        {skill.isSymlink && (
                          <span className="shrink-0 rounded-full bg-[var(--button-fill)] px-2 py-0.5 text-caption font-medium text-muted-foreground">
                            链接
                          </span>
                        )}
                      </div>
                    </div>
                    <ActionTooltip label="删除 Skill">
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation();
                          setDeleteName(skill.dirName);
                        }}
                        aria-label="删除 Skill"
                        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 size={14} strokeWidth={2.2} />
                      </button>
                    </ActionTooltip>
                  </div>
                  <p className="line-clamp-2 min-h-[40px] text-body leading-relaxed text-muted-foreground">
                    {skill.description || '（无描述）'}
                  </p>
                </div>
                <div className="mt-auto border-t border-[var(--hairline-divider)] px-5 py-2.5">
                  <p className="truncate font-mono text-caption text-[var(--label)]" title={skill.path}>
                    {skill.path}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 详情弹窗 */}
      <Dialog open={!!detail} onOpenChange={(open) => { if (!open) setDetail(null); }}>
        <DialogContent className="flex max-h-[82vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-[var(--hairline-divider)] px-6 py-4 pr-14">
            <div className="flex items-center gap-2">
              <DialogTitle>{detail?.name}</DialogTitle>
              {detail?.isSymlink && (
                <span className="rounded-full bg-[var(--button-fill)] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">
                  链接
                </span>
              )}
            </div>
            <DialogDescription className="truncate font-mono text-caption">
              {detail?.path} · {detail?.fileCount} 个文件
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {detail && <Markdown content={detail.content} />}
          </div>
        </DialogContent>
      </Dialog>

      {detailLoading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--dialog-overlay)]">
          <div className="bento-popup flex items-center gap-2.5 px-5 py-3.5 text-body text-muted-foreground">
            <LoaderCircle className="animate-spin" size={14} strokeWidth={2.5} />
            加载详情中…
          </div>
        </div>
      )}

      {/* 添加弹窗 */}
      <Dialog open={isAddOpen} onOpenChange={(open) => { if (!open) setIsAddOpen(false); }}>
        <DialogContent className="max-w-md gap-4 p-6">
          <DialogHeader>
            <DialogTitle>添加 Skill</DialogTitle>
            <DialogDescription>
              输入包含 <code className="font-mono text-foreground">SKILL.md</code> 的本地目录路径，将复制到{' '}
              <code className="font-mono">~/.agents/skills/</code>。
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3">
            <Input
              value={addPath}
              onChange={e => {
                setAddPath(e.target.value);
                setAddError(null);
              }}
              placeholder="例如：/Users/you/projects/my-skill"
              className="font-mono text-body"
            />
            {addError && (
              <div className="rounded-[9px] bg-destructive/8 px-3 py-2 text-label text-destructive break-all">
                {addError}
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-[var(--hairline-divider)] pt-3">
            <Button variant="outline" size="sm" onClick={() => setIsAddOpen(false)} disabled={isAdding}>
              取消
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => void handleAdd()}
              disabled={isAdding}
              className="min-w-[84px]"
            >
              {isAdding && <LoaderCircle className="animate-spin" size={12} strokeWidth={2.5} />}
              {isAdding ? '添加中…' : '添加'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        isOpen={deleteName !== null}
        title="删除 Skill"
        message={`确定删除 Skill "${deleteName}" 吗？将同时删除 ~/.agents/skills/${deleteName} 目录。`}
        confirmDisabled={isDeleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleteName(null)}
      />
    </div>
  );
};

export default SkillManager;
