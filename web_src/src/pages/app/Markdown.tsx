import { memo, useMemo, lazy, Suspense, type ComponentProps } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";
import { NodeChipFromLink } from "@/components/AgentSidebar/widgets/NodeChip";

const MermaidWidget = lazy(() =>
  import("@/components/AgentSidebar/widgets/MermaidWidget").then((mod) => ({ default: mod.MermaidWidget })),
);

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
 * Allowed URL protocols for links and images. Blocks dangerous protocols like
 * `javascript:`, `data:`, `vbscript:`, etc. that could execute scripts or load
 * untrusted content.
 */
const ALLOWED_URL_PROTOCOLS = ["http", "https", "mailto"];

/**
 * Special link prefixes used for internal references (node mentions).
 * These bypass normal URL transformation but are rendered as safe React components.
 */
const SPECIAL_LINK_PREFIXES = ["node:"];

/**
 * Sanitize schema extending the rehype-sanitize defaults with:
 * - `<details>` / `<summary>` (plus the `open` attribute) for collapsible sections
 * - Strict URL policy blocking dangerous protocols
 * - No raw HTML passthrough (rehype-raw is NOT used)
 *
 * This prevents XSS via:
 * - Script tags and event handler attributes (default schema)
 * - javascript:, data:, vbscript: URLs (custom protocol filter)
 * - Arbitrary HTML injection (no raw HTML support)
 */
const MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), "details", "summary"],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    details: [...(defaultSchema.attributes?.details ?? []), "open"],
  },
  protocols: {
    href: ALLOWED_URL_PROTOCOLS,
    src: ALLOWED_URL_PROTOCOLS,
    cite: ALLOWED_URL_PROTOCOLS,
    longdesc: ALLOWED_URL_PROTOCOLS,
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
 * Render a markdown string with the standard GFM + line-break + sanitized
 * pipeline used across the app (console panels, file viewer, etc).
 * Returns `null` when the content is empty (or whitespace-only) so the caller
 * can decide whether to show its own empty state.
 *
 * Only line endings are normalized; leading/trailing whitespace is preserved
 * so file viewers render exactly what's on disk (e.g. an indented code block
 * at the very start of a file stays an indented code block).
 *
 * Supports:
 * - Mermaid diagrams (```mermaid code blocks) - lazy-loaded
 * - Node mention chips (node:nodeId links) - reuses existing agent sidebar syntax
 * - Syntax-highlighted code blocks
 * - All standard markdown features (tables, images, links, etc.)
 *
 * Security:
 * - No raw HTML passthrough (rehype-raw is NOT used)
 * - Strict URL protocol allowlist (http, https, mailto only)
 * - Blocks javascript:, data:, vbscript: and other dangerous protocols
 * - Mermaid uses strict security mode (configured in MermaidWidget)
 *
 * Performance:
 * - Memoized by content to prevent re-parsing on parent re-renders
 * - Mermaid is lazy-loaded and only initialized when needed
 */
export const MarkdownContent = memo(function MarkdownContent({
  content,
  className,
  "data-testid": dataTestId,
  canvasId,
  organizationId,
}: MarkdownContentProps) {
  const normalized = useMemo(() => content.replace(/\r\n/g, "\n"), [content]);

  if (!normalized.trim()) return null;

  return (
    <div className={cn(MARKDOWN_CONTENT_CLASSES, className)} data-testid={dataTestId}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[[rehypeSanitize, MARKDOWN_SANITIZE_SCHEMA]]}
        urlTransform={(url) => (isSpecialLink(url) ? url : defaultUrlTransform(url))}
        components={{
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const language = match?.[1];
            const code = String(children).replace(/\n$/, "");

            // Render Mermaid diagrams (lazy-loaded)
            if (language === "mermaid") {
              return (
                <Suspense
                  fallback={
                    <div className="my-4 flex items-center justify-center py-4 text-xs text-slate-400">
                      Loading diagram...
                    </div>
                  }
                >
                  <MermaidWidget content={code} />
                </Suspense>
              );
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
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
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
});

/**
 * Custom link renderer that handles special internal link types and regular URLs.
 *
 * Node mentions (node:nodeId) are rendered as interactive chips using the existing
 * agent sidebar pattern from RichMessage.tsx and RubricWidget.tsx. This ensures
 * consistent mention syntax across markdown in chat, file viewer, and console panels.
 */
function MarkdownLink({
  href,
  children,
  canvasId,
  organizationId,
}: ComponentProps<"a"> & { canvasId?: string; organizationId?: string }) {
  // Render node mention chips (reuses existing agent sidebar pattern)
  const nodeMatch = href?.match(/^node:(.+)$/);
  if (nodeMatch && canvasId && organizationId) {
    const label = typeof children === "string" ? children : undefined;
    return (
      <NodeChipFromLink nodeId={nodeMatch[1]} rawLabel={label} canvasId={canvasId} organizationId={organizationId} />
    );
  }

  // Regular links (rehype-sanitize already blocked dangerous protocols)
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

/**
 * Check if a URL is a special internal link that should bypass normal URL
 * transformation. These are rendered as React components, not actual links.
 */
function isSpecialLink(url: string): boolean {
  return SPECIAL_LINK_PREFIXES.some((prefix) => url.startsWith(prefix));
}
