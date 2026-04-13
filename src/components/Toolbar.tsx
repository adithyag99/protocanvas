import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { LayoutGrid, Focus, EyeOff, Moon, Sun, TerminalSquare } from "lucide-react"

export type FilterMode = "all" | "hidden"

interface ToolbarProps {
  component: string
  hiddenCount: number
  focusMode: boolean
  onFocusModeToggle: () => void
  filter: FilterMode
  onFilterChange: (filter: FilterMode) => void
  onTidyUp: () => void
  darkMode: boolean
  onDarkModeToggle: () => void
  terminalOpen: boolean
  onTerminalToggle: () => void
  onExitFocus?: () => void
}

const exitFocusClick = (onExitFocus?: () => void) => (e: React.MouseEvent) => {
  if (onExitFocus && (e.target as HTMLElement).closest("button") === null) {
    onExitFocus()
  }
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
  darkMode,
  onDarkModeToggle,
  terminalOpen,
  onTerminalToggle,
  onExitFocus,
}: ToolbarProps) {
  const canvasBg = darkMode ? "#1e1e1e" : "#ebebeb"

  return (
    <>
      {/* Left: title — blurred background layer + sharp content on top */}
      <div
        className="fixed z-50"
        style={{
          top: -40,
          left: -40,
          opacity: focusMode ? 0 : 1,
          transform: focusMode ? "translateY(-8px)" : "translateY(0)",
          transition: `opacity ${focusMode ? "150ms" : "200ms"} ${EASE_OUT}, transform ${focusMode ? "150ms" : "200ms"} ${EASE_OUT}`,
          pointerEvents: focusMode ? "none" : "auto",
          willChange: "transform, opacity",
        }}
        onClick={exitFocusClick(onExitFocus)}
      >
        {/* Blurred bg layer */}
        <div style={{
          position: "absolute",
          inset: 0,
          background: canvasBg,
          borderRadius: "0 0 24px 0", /* only bottom-right */
          filter: "blur(16px)",
        }} />
        {/* Sharp content on top */}
        <div style={{ position: "relative", zIndex: 1, paddingTop: 40, paddingLeft: 62, paddingRight: 32, paddingBottom: 12 }}>
          <div className="h-12 flex items-center">
            <span className="text-sm font-semibold tracking-tight leading-none" style={{ color: darkMode ? "#e0e0e0" : undefined }}>
              {component || "Protocanvas"}
            </span>
          </div>
        </div>
      </div>

      {/* Right: controls container — blurred bg layer + sharp content */}
      <div
        className="fixed z-50"
        style={{
          top: -40,
          right: -40,
        }}
        onClick={exitFocusClick(onExitFocus)}
      >
        {/* Blurred bg layer */}
        <div style={{
          position: "absolute",
          inset: 0,
          background: canvasBg,
          borderRadius: "0 0 0 24px", /* only bottom-left */
          filter: "blur(16px)",
        }} />
        {/* Sharp content on top */}
        <div style={{ position: "relative", zIndex: 1, paddingTop: 40, paddingRight: 48, paddingBottom: 12, paddingLeft: 32 }}>
        <div className="h-12 flex items-center">
          <div className="flex items-center gap-1">
            {/* Hidden cards toggle + Tidy up — fade out in focus mode */}
            <div
              className="flex items-center gap-1"
              style={{
                opacity: focusMode ? 0 : 1,
                width: focusMode ? 0 : "auto",
                overflow: "hidden",
                transform: focusMode ? "translateX(8px) scale(0.95)" : "translateX(0) scale(1)",
                transition: `opacity ${focusMode ? "120ms" : "200ms"} ${EASE_OUT}, transform ${focusMode ? "120ms" : "200ms"} ${EASE_OUT}, width ${focusMode ? "120ms" : "200ms"} ${EASE_OUT}`,
                pointerEvents: focusMode ? "none" : "auto",
                willChange: "transform, opacity, width",
              }}
            >
              {hiddenCount > 0 && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        className={`h-8 px-2.5 flex items-center gap-1.5 rounded-md transition-colors cursor-pointer ${
                          filter === "hidden"
                            ? "bg-foreground/10 text-foreground"
                            : "text-muted-foreground hover:text-foreground"
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
                      className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                      onClick={onTidyUp}
                    />
                  }
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">Tidy up</TooltipContent>
              </Tooltip>

            </div>

            {/* Dark mode */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className="h-8 w-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    onClick={onDarkModeToggle}
                  />
                }
              >
                {darkMode ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">{darkMode ? "Light mode" : "Dark mode"}</TooltipContent>
            </Tooltip>

            {/* Focus toggle */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                      focusMode
                        ? "bg-foreground/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
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

            {/* Terminal toggle */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    className={`h-8 w-8 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
                      terminalOpen
                        ? "bg-foreground/10 text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={onTerminalToggle}
                  />
                }
              >
                <TerminalSquare className="h-3.5 w-3.5" />
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">Terminal</TooltipContent>
            </Tooltip>

          </div>
        </div>
        </div>
      </div>
    </>
  )
}
