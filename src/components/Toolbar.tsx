import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { LayoutGrid, Focus, EyeOff } from "lucide-react"

export type FilterMode = "all" | "hidden"

interface ToolbarProps {
  component: string
  hiddenCount: number
  focusMode: boolean
  onFocusModeToggle: () => void
  filter: FilterMode
  onFilterChange: (filter: FilterMode) => void
  onTidyUp: () => void
  onExitFocus?: () => void
}

const exitFocusClick = (onExitFocus?: () => void) => (e: React.MouseEvent) => {
  if (onExitFocus && (e.target as HTMLElement).closest("button") === null) {
    onExitFocus()
  }
}

const maskLeft: React.CSSProperties = {
  background: "#ebebeb",
  WebkitMaskImage:
    "linear-gradient(to bottom, black 40%, transparent), linear-gradient(to right, black 60%, transparent)",
  WebkitMaskComposite: "source-in",
  maskImage:
    "linear-gradient(to bottom, black 40%, transparent), linear-gradient(to right, black 60%, transparent)",
  maskComposite: "intersect",
}

const maskRight: React.CSSProperties = {
  background: "#ebebeb",
  WebkitMaskImage:
    "linear-gradient(to bottom, black 40%, transparent), linear-gradient(to left, black 60%, transparent)",
  WebkitMaskComposite: "source-in",
  maskImage:
    "linear-gradient(to bottom, black 40%, transparent), linear-gradient(to left, black 60%, transparent)",
  maskComposite: "intersect",
}

// ease-out-quart — snappy entrance, smooth settle
const EASE_OUT = "cubic-bezier(0.165, 0.84, 0.44, 1)"

export function Toolbar({
  component,
  hiddenCount,
  focusMode,
  onFocusModeToggle,
  filter,
  onFilterChange,
  onTidyUp,
  onExitFocus,
}: ToolbarProps) {
  return (
    <>
      {/* Left: title — slides up and fades out in focus mode */}
      <div
        className="fixed top-0 left-0 z-50 pl-4 pr-12 pb-6"
        style={{
          ...maskLeft,
          opacity: focusMode ? 0 : 1,
          transform: focusMode ? "translateY(-8px)" : "translateY(0)",
          transition: `opacity ${focusMode ? "150ms" : "200ms"} ${EASE_OUT}, transform ${focusMode ? "150ms" : "200ms"} ${EASE_OUT}`,
          pointerEvents: focusMode ? "none" : "auto",
          willChange: "transform, opacity",
        }}
        onClick={exitFocusClick(onExitFocus)}
      >
        <div className="h-12 flex items-center">
          <span className="text-sm font-semibold tracking-tight leading-none">
            {component || "Protocanvas"}
          </span>
        </div>
      </div>

      {/* Right: controls container */}
      <div
        className="fixed top-0 right-0 z-50 pr-4 pl-12 pb-6"
        style={focusMode ? undefined : maskRight}
        onClick={exitFocusClick(onExitFocus)}
      >
        <div className="h-12 flex items-center">
          <div className="flex items-center gap-0.5">
            {/* Hidden cards toggle + Tidy up — fade out in focus mode */}
            <div
              className="flex items-center gap-0.5"
              style={{
                opacity: focusMode ? 0 : 1,
                transform: focusMode ? "translateX(8px) scale(0.95)" : "translateX(0) scale(1)",
                transition: `opacity ${focusMode ? "120ms" : "200ms"} ${EASE_OUT}, transform ${focusMode ? "120ms" : "200ms"} ${EASE_OUT}`,
                pointerEvents: focusMode ? "none" : "auto",
                willChange: "transform, opacity",
              }}
            >
              {hiddenCount > 0 && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        className={`h-7 px-2 flex items-center gap-1.5 rounded-[6px] transition-colors cursor-pointer ${
                          filter === "hidden"
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        }`}
                        onClick={() => onFilterChange(filter === "hidden" ? "all" : "hidden")}
                      />
                    }
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">{hiddenCount}</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {filter === "hidden" ? "Show all cards" : `Show ${hiddenCount} hidden`}
                  </TooltipContent>
                </Tooltip>
              )}

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

            {/* Focus toggle — always visible, rightmost position */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className={`h-7 w-7 flex items-center justify-center rounded-[6px] transition-colors cursor-pointer ${
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
                Focus mode <kbd className="ml-1.5 px-1 py-0.5 bg-white/15 rounded text-[10px] font-mono">F</kbd>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </>
  )
}
