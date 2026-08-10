import React from 'react';

/**
 * 轻量安全的 Markdown 渲染器。
 *
 * 覆盖本项目发布说明用到的语法：标题、无序/有序列表、粗体、斜体、
 * 行内代码、代码块、链接、水平线与段落。始终构建 React 元素，
 * 不使用 dangerouslySetInnerHTML，避免注入风险。
 */

type InlineNode =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'em'; children: InlineNode[] }
  | { type: 'code'; text: string }
  | { type: 'link'; url: string; children: InlineNode[] };

function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let i = 0;

  const pushText = (text: string) => {
    if (text) nodes.push({ type: 'text', text });
  };

  while (i < source.length) {
    const char = source[i];

    if (char === '`') {
      const end = source.indexOf('`', i + 1);
      if (end !== -1) {
        nodes.push({ type: 'code', text: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    }

    if (char === '[') {
      const closeBracket = source.indexOf(']', i);
      if (closeBracket !== -1 && source[closeBracket + 1] === '(') {
        const closeParen = source.indexOf(')', closeBracket + 2);
        if (closeParen !== -1) {
          nodes.push({
            type: 'link',
            url: source.slice(closeBracket + 2, closeParen),
            children: parseInline(source.slice(i + 1, closeBracket)),
          });
          i = closeParen + 1;
          continue;
        }
      }
    }

    if (source.startsWith('**', i)) {
      const end = source.indexOf('**', i + 2);
      if (end !== -1) {
        nodes.push({ type: 'strong', children: parseInline(source.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }

    if (char === '*') {
      const end = source.indexOf('*', i + 1);
      if (end !== -1) {
        nodes.push({ type: 'em', children: parseInline(source.slice(i + 1, end)) });
        i = end + 1;
        continue;
      }
    }

    let j = i;
    while (j < source.length && !['`', '*', '['].includes(source[j])) j += 1;
    if (j > i) {
      pushText(source.slice(i, j));
      i = j;
    } else {
      pushText(char);
      i += 1;
    }
  }

  return nodes;
}

function renderInline(nodes: InlineNode[]): React.ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <React.Fragment key={index}>{node.text}</React.Fragment>;
      case 'strong':
        return (
          <strong key={index} className="font-semibold text-black">
            {renderInline(node.children)}
          </strong>
        );
      case 'em':
        return <em key={index}>{renderInline(node.children)}</em>;
      case 'code':
        return (
          <code
            key={index}
            className="rounded bg-[#F5F5F5] border border-[#EAEAEA] px-1 py-0.5 font-mono text-[12px] text-[#333333]"
          >
            {node.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={index}
            href={node.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

function renderBlocks(body: string): React.ReactNode {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  const isListStart = (line: string) => /^\s*[-*+]\s+/.test(line) || /^\s*\d+\.\s+/.test(line);
  const isHeadingStart = (line: string) => /^(#{1,5})\s+/.test(line);

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    if (line.trim().startsWith('```')) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      nodes.push(
        <pre
          key={key++}
          className="my-3 overflow-x-auto rounded-lg bg-[#1E1E1E] px-3.5 py-3 font-mono text-[12px] leading-relaxed text-[#D4D4D4]"
        >
          {codeLines.join('\n')}
        </pre>,
      );
      continue;
    }

    const heading = line.match(/^(#{1,5})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const HeadingTag = (`h${Math.min(level, 6)}`) as HeadingTag;
      const headingClass =
        level === 1
          ? 'mb-2 mt-4 text-[16px] font-bold text-black'
          : level === 2
            ? 'mb-2 mt-4 text-[15px] font-semibold text-black'
            : level === 3
              ? 'mb-1.5 mt-3 text-[14px] font-semibold text-black'
              : 'mb-1.5 mt-3 text-[13px] font-semibold text-black';
      nodes.push(
        <HeadingTag key={key++} className={headingClass}>
          {renderInline(parseInline(heading[2]))}
        </HeadingTag>,
      );
      i += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      nodes.push(<hr key={key++} className="my-4 border-[#EAEAEA]" />);
      i += 1;
      continue;
    }

    const items: Array<{ ordered: boolean; text: string }> = [];
    while (i < lines.length) {
      const ulMatch = lines[i].match(/^\s*[-*+]\s+(.*)$/);
      const olMatch = lines[i].match(/^\s*\d+\.\s+(.*)$/);
      if (ulMatch) {
        items.push({ ordered: false, text: ulMatch[1] });
        i += 1;
      } else if (olMatch) {
        items.push({ ordered: true, text: olMatch[1] });
        i += 1;
      } else {
        break;
      }
    }
    if (items.length > 0) {
      const ordered = items[0].ordered;
      const ListTag = ordered ? 'ol' : 'ul';
      nodes.push(
        <ListTag
          key={key++}
          className={`my-2 space-y-1.5 pl-5 ${ordered ? 'list-decimal' : 'list-disc'}`}
        >
          {items.map((item, index) => (
            <li key={index} className="text-[13px] leading-relaxed text-[#555555]">
              {renderInline(parseInline(item.text))}
            </li>
          ))}
        </ListTag>,
      );
      continue;
    }

    const paraLines = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !isHeadingStart(lines[i]) &&
      !isListStart(lines[i]) &&
      !lines[i].trim().startsWith('```')
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    nodes.push(
      <p key={key++} className="my-2 text-[13px] leading-relaxed text-[#555555]">
        {renderInline(parseInline(paraLines.join(' ')))}
      </p>,
    );
  }

  return nodes;
}

export default function Markdown({ content }: { content: string }) {
  return <div className="select-text">{renderBlocks(content)}</div>;
}
