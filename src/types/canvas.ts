export interface VariantNodeData {
  id: string
  label: string
  parentId: string | null
  position: { x: number; y: number }
  htmlFile: string
  rationale: string
  avoids: string
  createdAt: string
  hidden?: boolean
}

export interface CanvasEdge {
  from: string
  to: string
  label: string
}

export interface CanvasState {
  component: string
  sourceFile: string
  variantWidth: number
  nodes: Record<string, VariantNodeData>
  edges: CanvasEdge[]
  viewport: { x: number; y: number; zoom: number }
}

export interface FeedbackEntry {
  text: string
  action: "branch" | "iterate"
  read: boolean
}

export interface FeedbackState {
  picked: string[]
  feedback: Record<string, FeedbackEntry | string>
}

export interface AppConfig {
  component: string
  dir: string
  variantsDir: string
  port: number
}
