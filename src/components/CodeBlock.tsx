'use client';

import { useState, useRef } from 'react';

interface CodeBlockProps {
  children: React.ReactNode;
  className?: string;
}

export default function CodeBlock({ children, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);

  // 언어 추출 (className="language-yaml" 형태)
  const language = className?.replace('language-', '') || 'code';

  const handleCopy = async () => {
    if (codeRef.current) {
      const code = codeRef.current.textContent || '';
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative group my-6">
      {/* 헤더 바 */}
      <div className="flex items-center justify-between px-4 py-2 bg-[var(--bg-tertiary)] rounded-t-lg border border-b-0 border-[var(--border)]">
        <span className="text-xs text-[var(--text-muted)] font-mono uppercase">
          {language}
        </span>
        <button
          onClick={handleCopy}
          className={`
            flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all
            ${copied
              ? 'bg-green-500/20 text-green-400'
              : 'bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-primary)]'}
          `}
        >
          {copied ? (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              복사됨!
            </>
          ) : (
            <>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              복사
            </>
          )}
        </button>
      </div>

      {/* 코드 블록 */}
      <pre
        ref={codeRef}
        className={`
          !mt-0 !rounded-t-none
          bg-[var(--bg-secondary)] border border-t-0 border-[var(--border)] rounded-b-lg
          p-4 overflow-x-auto
          ${className}
        `}
      >
        {children}
      </pre>
    </div>
  );
}
