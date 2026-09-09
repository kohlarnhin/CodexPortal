import React from 'react';
import { TextMatch } from '../../utils/sessionSearch';

interface HighlightedTextProps {
  text: string;
  matches: TextMatch[];
  firstMatchIndex?: number;
  activeMatchIndex?: number;
}

const HighlightedText: React.FC<HighlightedTextProps> = ({
  text, matches, firstMatchIndex = 0, activeMatchIndex,
}) => {
  if (matches.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  matches.forEach((match, index) => {
    const matchIndex = firstMatchIndex + index;
    parts.push(text.slice(cursor, match.start));
    parts.push(
      <mark
        key={match.start}
        data-search-match={matchIndex}
        aria-current={matchIndex === activeMatchIndex ? 'true' : undefined}
        className={matchIndex === activeMatchIndex
          ? 'rounded-sm bg-black text-white scroll-mt-4'
          : 'rounded-sm bg-[#E5E5E5] text-black scroll-mt-4'}
      >
        {text.slice(match.start, match.end)}
      </mark>,
    );
    cursor = match.end;
  });
  parts.push(text.slice(cursor));
  return <>{parts}</>;
};

export default HighlightedText;
