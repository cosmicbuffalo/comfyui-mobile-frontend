import { useMemo, type ReactNode } from 'react';
import { parseMarkdown, type MdBlock, type MdInline } from '../../../utils/markdown';

function renderInline(nodes: MdInline[], keyPrefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case 'text':
        return <span key={key}>{node.value}</span>;
      case 'break':
        return <br key={key} />;
      case 'strong':
        return (
          <strong key={key} className="font-semibold text-slate-100">
            {renderInline(node.children, key)}
          </strong>
        );
      case 'em':
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case 'del':
        return (
          <del key={key} className="opacity-70">
            {renderInline(node.children, key)}
          </del>
        );
      case 'codeSpan':
        return (
          <code key={key} className="md-code-inline">
            {node.value}
          </code>
        );
      case 'link':
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noreferrer"
            className="text-cyan-300 underline break-all"
          >
            {renderInline(node.children, key)}
          </a>
        );
      case 'image':
        return (
          <img
            key={key}
            src={node.src}
            alt={node.alt}
            loading="lazy"
            className="md-image"
          />
        );
    }
  });
}

const HEADING_CLASSES: Record<number, string> = {
  1: 'text-xl font-semibold mt-3 mb-2 first:mt-0',
  2: 'text-lg font-semibold mt-3 mb-2 first:mt-0',
  3: 'text-base font-semibold mt-2.5 mb-1.5 first:mt-0',
  4: 'text-sm font-semibold mt-2 mb-1 first:mt-0',
  5: 'text-sm font-semibold mt-2 mb-1 first:mt-0 text-slate-300',
  6: 'text-xs font-semibold mt-2 mb-1 first:mt-0 uppercase tracking-wide text-slate-400',
};

function renderBlocks(blocks: MdBlock[], keyPrefix: string): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (block.type) {
      case 'heading': {
        const Tag = `h${Math.min(6, block.level)}` as 'h1';
        return (
          <Tag key={key} className={`md-heading ${HEADING_CLASSES[block.level] ?? HEADING_CLASSES[6]}`}>
            {renderInline(block.children, key)}
          </Tag>
        );
      }
      case 'paragraph':
        return (
          <p key={key} className="md-paragraph my-2 first:mt-0 last:mb-0 break-words">
            {renderInline(block.children, key)}
          </p>
        );
      case 'codeBlock':
        return (
          <pre key={key} className="md-code-block" data-lang={block.lang ?? undefined}>
            <code>{block.value}</code>
          </pre>
        );
      case 'thematicBreak':
        return <hr key={key} className="md-rule my-3 border-slate-700" />;
      case 'blockquote':
        return (
          <blockquote key={key} className="md-quote">
            {renderBlocks(block.children, key)}
          </blockquote>
        );
      case 'list': {
        const Tag = block.ordered ? 'ol' : 'ul';
        return (
          <Tag
            key={key}
            className={`md-list ${block.ordered ? 'md-list-ordered' : 'md-list-bullet'}`}
            start={block.ordered && block.start !== 1 ? block.start : undefined}
          >
            {block.items.map((item, itemIndex) => {
              const itemKey = `${key}-i${itemIndex}`;
              // A single-paragraph item renders inline so tight lists stay compact.
              const tight = !block.loose && item.length === 1 && item[0].type === 'paragraph';
              return (
                <li key={itemKey} className="md-list-item">
                  {tight && item[0].type === 'paragraph'
                    ? renderInline(item[0].children, itemKey)
                    : renderBlocks(item, itemKey)}
                </li>
              );
            })}
          </Tag>
        );
      }
      case 'table':
        return (
          <div key={key} className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th key={`${key}-h${cellIndex}`} style={{ textAlign: block.align[cellIndex] ?? undefined }}>
                      {renderInline(cell, `${key}-h${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={`${key}-r${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${key}-r${rowIndex}c${cellIndex}`}
                        style={{ textAlign: block.align[cellIndex] ?? undefined }}
                      >
                        {renderInline(cell, `${key}-r${rowIndex}c${cellIndex}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  });
}

interface MarkdownContentProps {
  text: string;
}

/** Renders MarkdownNote bodies as formatted content instead of raw syntax. */
export function MarkdownContent({ text }: MarkdownContentProps) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return <div className="md-content">{renderBlocks(blocks, 'md')}</div>;
}
