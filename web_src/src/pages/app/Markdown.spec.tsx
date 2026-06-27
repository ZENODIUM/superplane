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
      const mermaidCodeBlock = Array.from(codeBlocks).find(
        code => code.className.includes("language-mermaid")
      );
      expect(mermaidCodeBlock).toBeUndefined();
    });
    
    // Should render as a diagram (the MermaidWidget renders the SVG)
    await waitFor(() => {
      expect(view.textContent).toContain("Rendering diagram");
    }, { timeout: 2000 });
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

  it("returns null for empty content", () => {
    const { container } = render(
      <MarkdownContent content="" data-testid="markdown-preview" />
    );
    expect(container.firstChild).toBeNull();
  });

  it("returns null for whitespace-only content", () => {
    const { container } = render(
      <MarkdownContent content="   \n\n   " data-testid="markdown-preview" />
    );
    expect(container.firstChild).toBeNull();
  });
});
