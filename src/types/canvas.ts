export interface VariantNodeData {
  id: string
  label: string
  parentId: string | null
  position: { x: number; y: number }
  htmlFile: string
  createdAt: string
  hidden?: boolean
  customWidth?: number
  type?: "html" | "tsx"
}

export interface CanvasEdge {
  from: string
  to: string
  label: string
  feedbackText?: string
}

export interface CanvasState {
  component: string
  sourceFile: string
  variantWidth: number
  nodes: Record<string, VariantNodeData>
  edges: CanvasEdge[]
  viewport: { x: number; y: number; zoom: number }
}

export interface AppConfig {
  component: string
  dir: string
  variantsDir: string
  port: number
  vitePort?: number
}
