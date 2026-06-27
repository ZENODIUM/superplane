import { type ComponentProps } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { MermaidWidget } from "@/components/AgentSidebar/widgets/MermaidWidget";
import { NodeChipFromLink } from "@/components/AgentSidebar/widgets/NodeChip";

/**
 * Tailwind class string shared by every full-document markdown renderer in the
 * app. We deliberately do not use the official `prose` plugin so headings,
 * code blocks, tables, and `<details>` stay visually consistent with the
 * canvas chrome at small panel sizes.
 */
const MARKDOWN_CONTENT_CLASSES =
  "max-w-none text-sm text-slate-800 " +
  "[&_h1]:mb-1.5 [&_h1]:mt-1 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:leading-tight [&_h1:first-child]:mt-0 " +
  "[&_h2]:mb-1 [&_h2]:mt-1 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:leading-tight [&_h2:first-child]:mt-0 " +
  "[&_h3]:mb-0.5 [&_h3]:mt-1 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:leading-tight [&_h3:first-child]:mt-0 " +
  "[&_h4]:mb-0.5 [&_h4]:mt-1 [&_h4]:text-sm [&_h4]:font-medium [&_h4]:leading-tight [&_h4:first-child]:mt-0 " +
  "[&_p]:mb-2 [&_p]:leading-relaxed " +
  "[&_ol]:mb-2 [&_ol]:ml-5 [&_ol]:list-decimal " +
  "[&_ul]:mb-2 [&_ul]:ml-5 [&_ul]:list-disc [&_li]:mb-1 " +
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 " +
  "[&_code]:rounded [&_code]:bg-slate-100 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs " +
  "[&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-slate-100 [&_pre]:p-2 " +
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 " +
  "[&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-current " +
  "[&_table]:my-2 [&_table]:text-xs [&_table]:border-collapse [&_th]:border [&_th]:border-slate-200 [&_th]:px-2 [&_th]:py-1 " +
  "[&_td]:border [&_td]:border-slate-100 [&_td]:px-2 [&_td]:py-1 " +
  "[&_details]:my-3 [&_details]:rounded-md [&_details]:border [&_details]:border-slate-200 [&_details]:bg-slate-50/60 [&_details]:p-3 " +
  "[&_details>summary]:flex [&_details>summary]:items-center [&_details>summary]:cursor-pointer [&_details>summary]:select-none [&_details>summary]:text-sm [&_details>summary]:font-semibold [&_details>summary]:text-slate-900 [&_details>summary]:list-none [&_details>summary]:marker:hidden [&_details>summary]:hover:text-sky-700 " +
  "[&_details>summary]:before:content-['▸'] [&_details>summary]:before:mr-2 [&_details>summary]:before:text-slate-500 [&_details>summary]:before:transition-transform [&_details>summary]:before:duration-200 " +
  "[&_details[open]>summary]:mb-3 [&_details[open]>summary]:before:rotate-90 " +
  "[&_details>*:last-child]:mb-0";

/**
 * Sanitize schema extending the rehype-sanitize defaults with `<details>` /
 * `<summary>` (plus the `open` attribute) so collapsible sections can be
 * authored directly in markdown without weakening the rest of the policy
 * around scripts, event handlers, and inline styles.
 */
const MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    details: [...(defaultSchema.attributes?.details ?? []), "open"],
  },
};

interface MarkdownContentProps {
  content: string;
  className?: string;
  "data-testid"?: string;
  canvasId?: string;
  organizationId?: string;
}

/**
 * Render a markdown string with the standard GFM + line-break + sanitized-raw
 * HTML pipeline used across the app (console panels, file viewer, etc).
 * Returns `null` when the content is empty (or whitespace-only) so the caller
 * can decide whether to show its own empty state.
 *
 * Only line endings are normalized; leading/trailing whitespace is preserved
 * so file viewers render exactly what's on disk (e.g. an indented code block
 * at the very start of a file stays an indented code block).
 * 
 * Supports:
 * - Mermaid diagrams (```mermaid code blocks)
 * - Node mention chips (node:nodeId links)
 * - Syntax-highlighted code blocks
 * - All standard markdown features (tables, images, links, etc.)
 */
export function MarkdownContent({ 
  content, 
  className, 
  "data-testid": dataTestId,
  canvasId,
  organizationId,
}: MarkdownContentProps) {
  const normalized = content.replace(/\r\n/g, "\n");
  if (!normalized.trim()) return null;
  return (
    <div className={cn(MARKDOWN_CONTENT_CLASSES, className)} data-testid={dataTestId}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}
        urlTransform={(url) => (isSpecialLink(url) ? url : defaultUrlTransform(url))}
        components={{
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const language = match?.[1];
            const code = String(children).replace(/\n$/, "");
            
            // Render Mermaid diagrams
            if (language === "mermaid") {
              return <MermaidWidget content={code} />;
            }
            
            // Render code blocks with language class
            if (match) {
              return (
                <pre>
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              );
            }
            
            // Render inline code
            return <code className={className} {...props}>{children}</code>;
          },
          a: ({ children, href }) => (
            <MarkdownLink href={href} canvasId={canvasId} organizationId={organizationId}>
              {children}
            </MarkdownLink>
          ),
        }}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

function MarkdownLink({
  href,
  children,
  canvasId,
  organizationId,
}: ComponentProps<"a"> & { canvasId?: string; organizationId?: string }) {
  // Render node mention chips
  const nodeMatch = href?.match(/^node:(.+)$/);
  if (nodeMatch && canvasId && organizationId) {
    const label = typeof children === "string" ? children : undefined;
    return (
      <NodeChipFromLink
        nodeId={nodeMatch[1]}
        rawLabel={label}
        canvasId={canvasId}
        organizationId={organizationId}
      />
    );
  }

  // Regular links
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function isSpecialLink(url: string): boolean {
  return url.startsWith("node:");
}
