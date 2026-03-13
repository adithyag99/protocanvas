import { useReactFlow } from "@xyflow/react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { ZoomIn, ZoomOut, Maximize, MousePointer2, Hand, RotateCcw, LayoutGrid, Focus } from "lucide-react"

export type FilterMode = "all" | "picked" | "with-feedback" | "hidden"

interface ToolbarProps {
  component: string
  nodeCount: number
  hiddenCount: number
  mode: "select" | "pan"
  onModeChange: (mode: "select" | "pan") => void
  focusMode: boolean
  onFocusModeToggle: () => void
  filter: FilterMode
  onFilterChange: (filter: FilterMode) => void
  onClearFeedback: () => void
  onTidyUp: () => void
}

export function Toolbar({
  component,
  nodeCount,
  hiddenCount,
  mode,
  onModeChange,
  focusMode,
  onFocusModeToggle,
  filter,
  onFilterChange,
  onClearFeedback,
  onTidyUp,
}: ToolbarProps) {
  const { zoomIn, zoomOut, fitView, zoomTo } = useReactFlow()

  return (
    <div className="fixed top-0 left-0 right-0 z-50 h-10 flex items-center gap-3 border-b border-border bg-background/95 backdrop-blur px-4">
      {/* Left: title */}
      <span className="text-sm font-semibold tracking-tight leading-none">
        {component || "Design Canvas"}
      </span>
      <span className="text-xs text-muted-foreground leading-none">
        {nodeCount} variant{nodeCount !== 1 ? "s" : ""}
      </span>

      <div className="w-px h-4 bg-border" />

      {/* Center: filters */}
      <div className="flex-1 flex justify-center">
        <div className="group flex items-center gap-1.5">
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {(["all", "picked", "with-feedback"] as const).map((f) => (
              <button
                key={f}
                className={`h-6 px-2.5 text-[11px] font-medium rounded transition-colors ${
                  filter === f
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                }`}
                onClick={() => onFilterChange(f)}
              >
                {f === "all" ? "All" : f === "picked" ? "Picked" : "Feedback"}
              </button>
            ))}
            {hiddenCount > 0 && (
              <button
                className={`h-6 px-2.5 text-[11px] font-medium rounded transition-colors ${
                  filter === "hidden"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                }`}
                onClick={() => onFilterChange(filter === "hidden" ? "all" : "hidden")}
              >
                Hidden ({hiddenCount})
              </button>
            )}
          </div>
          <button
            className="h-6 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground rounded transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
            onClick={onClearFeedback}
            title="Clear all feedback & picks"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Right: mode toggle + zoom */}
      <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${
                  mode === "select"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                }`}
                onClick={() => onModeChange("select")}
              />
            }
          >
            <MousePointer2 className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Select <kbd className="ml-1.5 px-1 py-0.5 bg-muted rounded text-[10px] font-mono">V</kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className={`h-7 w-7 flex items-center justify-center rounded transition-colors ${
                  mode === "pan"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground cursor-pointer"
                }`}
                onClick={() => onModeChange("pan")}
              />
            }
          >
            <Hand className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            Pan <kbd className="ml-1.5 px-1 py-0.5 bg-muted rounded text-[10px] font-mono">H</kbd>
            <span className="ml-1.5 text-muted-foreground">or hold Space</span>
          </TooltipContent>
        </Tooltip>
      </div>

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              className={`h-7 w-7 flex items-center justify-center rounded transition-colors cursor-pointer ${
                focusMode
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              }`}
              onClick={onFocusModeToggle}
            />
          }
        >
          <Focus className="h-3.5 w-3.5" />
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Focus mode <kbd className="ml-1.5 px-1 py-0.5 bg-muted rounded text-[10px] font-mono">F</kbd>
        </TooltipContent>
      </Tooltip>

      <div className="w-px h-4 bg-border" />

      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                onClick={() => zoomOut()}
              />
            }
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Zoom out</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                onClick={() => zoomIn()}
              />
            }
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Zoom in</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                onClick={() => zoomTo(1, { duration: 200 })}
              />
            }
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Reset zoom to 100%</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                onClick={() => fitView({ padding: 0.1 })}
              />
            }
          >
            <Maximize className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Fit all</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                className="h-7 w-7 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
                onClick={onTidyUp}
              />
            }
          >
            <LayoutGrid className="h-3.5 w-3.5" />
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Tidy up</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
