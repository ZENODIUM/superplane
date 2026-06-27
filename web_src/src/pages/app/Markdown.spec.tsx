import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { canvasKeys } from "@/hooks/useCanvasData";
import { MarkdownContent } from "./Markdown";

// Mock mermaid module
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg>mermaid diagram</svg>" }),
  },
}));

function renderMarkdown(content: string, canvasId?: string, organizationId?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  // Mock canvas data for node chip resolution
  if (canvasId && organizationId) {
    queryClient.setQueryData(canvasKeys.detail(organizationId, canvasId), {
      metadata: { id: canvasId, organizationId },
      spec: {
        nodes: [
          {
            id: "fetch-data",
            name: "Fetch Data",
            component: "http",
            type: "TYPE_ACTION",
          },
          {
            id: "send-email-abc123",
            name: "Send Email",
            component: "email",
            type: "TYPE_ACTION",
          },
        ],
      },
    });
  }

  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <MarkdownContent
          content={content}
          canvasId={canvasId}
          organizationId={organizationId}
          data-testid="markdown-preview"
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe("MarkdownContent rendering", () => {
  it("renders standard markdown features", () => {
    renderMarkdown("# Heading\n\n**Bold text** and *italic*\n\n- List item");

    const view = screen.getByTestId("markdown-preview");
    expect(view.querySelector("h1")?.textContent).toBe("Heading");
    expect(view.querySelector("strong")?.textContent).toBe("Bold text");
    expect(view.querySelector("em")?.textContent).toBe("italic");
    expect(view.querySelector("li")?.textContent).toBe("List item");
  });

  it("renders GFM tables", () => {
    const markdown = "| Feature | Status |\n| --- | --- |\n| Mermaid | Done |\n| Tables | Done |";
    renderMarkdown(markdown);

    const view = screen.getByTestId("markdown-preview");
    const table = view.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.querySelectorAll("th")).toHaveLength(2);
    expect(table!.querySelectorAll("tbody tr")).toHaveLength(2);
  });

  it("renders inline code", () => {
    renderMarkdown("Here is `inline code` in text");

    const view = screen.getByTestId("markdown-preview");
    const code = view.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe("inline code");
  });

  it("renders fenced code blocks with language class", () => {
    const markdown = "```typescript\nconst x = 42;\n```";
    renderMarkdown(markdown);

    const view = screen.getByTestId("markdown-preview");
    const code = view.querySelector("code");
    expect(code).not.toBeNull();
    expect(code!.className).toContain("language-typescript");
  });

  it("renders Mermaid diagrams instead of code blocks", async () => {
    const markdown = "```mermaid\ngraph TD\n  A --> B\n```";
    renderMarkdown(markdown);

    const view = screen.getByTestId("markdown-preview");

    // Should not render as a code block
    await waitFor(() => {
      const codeBlocks = view.querySelectorAll("pre > code");
      const mermaidCodeBlock = Array.from(codeBlocks).find((code) => code.className.includes("language-mermaid"));
      expect(mermaidCodeBlock).toBeUndefined();
    });

    // Should render as a diagram (the MermaidWidget renders the SVG)
    await waitFor(
      () => {
        expect(view.textContent).toContain("Rendering diagram");
      },
      { timeout: 2000 },
    );
  });

  it("renders node mention links as chips when canvas context is provided", async () => {
    const markdown = "Check [this node](node:fetch-data) for details";
    renderMarkdown(markdown, "canvas-1", "org-1");

    const view = screen.getByTestId("markdown-preview");

    // Should render as button (NodeChip component), not a regular link
    await waitFor(() => {
      const button = view.querySelector("button");
      expect(button).not.toBeNull();
      expect(button!.textContent).toContain("this node");
    });
  });

  it("renders regular links as anchors", () => {
    renderMarkdown("[External link](https://example.com)");

    const view = screen.getByTestId("markdown-preview");
    const anchor = view.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe("https://example.com");
    expect(anchor!.getAttribute("target")).toBe("_blank");
  });

  it("strips unsafe HTML like script tags", () => {
    renderMarkdown("Hello <script>alert('xss')</script> world");

    const view = screen.getByTestId("markdown-preview");
    expect(view.querySelector("script")).toBeNull();
    expect(view.textContent).toMatch(/Hello/);
    expect(view.textContent).toMatch(/world/);
  });

  it("blocks javascript: URLs in links", () => {
    renderMarkdown('[Click me](javascript:alert("xss"))');

    const view = screen.getByTestId("markdown-preview");
    const anchor = view.querySelector("a");
    expect(anchor).not.toBeNull();
    // rehype-sanitize removes the href attribute entirely when protocol is not allowed
    expect(anchor!.getAttribute("href")).not.toContain("javascript:");
  });

  it("blocks data: URLs in links", () => {
    renderMarkdown("[Click me](data:text/html,<script>alert(1)</script>)");

    const view = screen.getByTestId("markdown-preview");
    const anchor = view.querySelector("a");
    expect(anchor).not.toBeNull();
    // rehype-sanitize removes the href attribute entirely when protocol is not allowed
    expect(anchor!.getAttribute("href")).not.toContain("data:");
  });

  it("blocks vbscript: URLs in links", () => {
    renderMarkdown("[Click me](vbscript:msgbox(1))");

    const view = screen.getByTestId("markdown-preview");
    const anchor = view.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).not.toContain("vbscript:");
  });

  it("allows safe http/https URLs in links", () => {
    renderMarkdown("[Example](https://example.com)");

    const view = screen.getByTestId("markdown-preview");
    const anchor = view.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe("https://example.com");
  });

  it("allows mailto: URLs in links", () => {
    renderMarkdown("[Email](mailto:test@example.com)");

    const view = screen.getByTestId("markdown-preview");
    const anchor = view.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe("mailto:test@example.com");
  });

  it("blocks javascript: URLs in images", () => {
    renderMarkdown('![Alt text](javascript:alert("xss"))');

    const view = screen.getByTestId("markdown-preview");
    const img = view.querySelector("img");
    // Image should either not render or have src stripped
    if (img) {
      expect(img.getAttribute("src")).not.toContain("javascript:");
    }
  });

  it("blocks data: URLs in images", () => {
    renderMarkdown("![Alt text](data:text/html,<script>alert(1)</script>)");

    const view = screen.getByTestId("markdown-preview");
    const img = view.querySelector("img");
    // Image should either not render or have src stripped
    if (img) {
      expect(img.getAttribute("src")).not.toContain("data:");
    }
  });

  it("strips event handler attributes", () => {
    renderMarkdown('<div onclick="alert(1)">Click me</div>');

    const view = screen.getByTestId("markdown-preview");
    const divs = view.querySelectorAll("div");
    divs.forEach((div) => {
      expect(div.hasAttribute("onclick")).toBe(false);
      expect(div.hasAttribute("onerror")).toBe(false);
      expect(div.hasAttribute("onload")).toBe(false);
    });
  });

  it("does not allow iframe elements", () => {
    renderMarkdown('<iframe src="https://evil.com"></iframe>');

    const view = screen.getByTestId("markdown-preview");
    expect(view.querySelector("iframe")).toBeNull();
  });

  it("does not allow object/embed elements", () => {
    renderMarkdown('<object data="evil.swf"></object><embed src="evil.swf">');

    const view = screen.getByTestId("markdown-preview");
    expect(view.querySelector("object")).toBeNull();
    expect(view.querySelector("embed")).toBeNull();
  });

  it("handles complex XSS attempt with multiple vectors", () => {
    const malicious = `
      <script>alert('xss')</script>
      [Link](javascript:alert('xss'))
      ![Image](data:text/html,<script>alert(1)</script>)
      <img src="x" onerror="alert('xss')">
      <iframe src="https://evil.com"></iframe>
    `;

    renderMarkdown(malicious);

    const view = screen.getByTestId("markdown-preview");

    // No scripts
    expect(view.querySelector("script")).toBeNull();

    // No iframes
    expect(view.querySelector("iframe")).toBeNull();

    // No event handlers
    const allElements = view.querySelectorAll("*");
    allElements.forEach((el) => {
      Array.from(el.attributes).forEach((attr) => {
        expect(attr.name).not.toMatch(/^on/i);
      });
    });

    // No dangerous URLs
    view.querySelectorAll("a, img").forEach((el) => {
      const href = el.getAttribute("href") || el.getAttribute("src") || "";
      expect(href).not.toMatch(/^javascript:/i);
      expect(href).not.toMatch(/^data:/i);
      expect(href).not.toMatch(/^vbscript:/i);
    });
  });

  it("returns null for empty content", () => {
    const { container } = render(<MarkdownContent content="" data-testid="markdown-preview" />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null for whitespace-only content", () => {
    const { container } = render(<MarkdownContent content="   \n\n   " data-testid="markdown-preview" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("MarkdownContent performance", () => {
  it("handles large markdown files without freezing", () => {
    // Generate a large markdown document with various features
    const sections: string[] = [];

    // Add 100 sections with headings, paragraphs, lists, tables, and code blocks
    for (let i = 0; i < 100; i++) {
      sections.push(`## Section ${i}\n\nThis is paragraph ${i} with **bold** and *italic* text.\n\n`);
      sections.push(`- Item 1\n- Item 2\n- Item 3\n\n`);
      sections.push(`| Column A | Column B |\n| --- | --- |\n| Value ${i}A | Value ${i}B |\n\n`);
      sections.push(`\`\`\`typescript\nconst x${i} = ${i};\nconsole.log(x${i});\n\`\`\`\n\n`);
    }

    const largeMarkdown = sections.join("");

    // This should complete without throwing or timing out
    const start = performance.now();
    renderMarkdown(largeMarkdown);
    const duration = performance.now() - start;

    const view = screen.getByTestId("markdown-preview");

    // Verify content was rendered
    expect(view.querySelector("h2")).not.toBeNull();
    expect(view.querySelectorAll("table")).toHaveLength(100);

    // Should render in reasonable time (< 1 second for 100 sections)
    expect(duration).toBeLessThan(1000);
  });

  it("memoizes rendering to prevent re-parsing on parent re-renders", () => {
    const content = "# Test\n\nSome content";

    // First render
    const { rerender } = renderMarkdown(content);
    const view = screen.getByTestId("markdown-preview");
    const firstRenderResult = view.innerHTML;

    // Re-render with same content (simulates parent re-render)
    rerender(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <MarkdownContent content={content} data-testid="markdown-preview" />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    const secondRenderResult = view.innerHTML;

    // Output should be identical (memoization working)
    expect(secondRenderResult).toBe(firstRenderResult);
  });
});
