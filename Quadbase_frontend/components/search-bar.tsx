"use client"

import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useState, useEffect, useRef, useCallback, useId } from "react"

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
  onSearch: () => void
  /** Called when user selects a suggestion — receives the full suggestion string.
   *  Use this instead of onSearch to avoid the stale-closure problem:
   *  onSearch reads `query` from its parent's render-time closure, which may not
   *  yet reflect the newly selected suggestion when the handler fires.
   */
  onSelectSuggestion?: (suggestion: string) => void
}

// Debounce helper — waits `delay` ms after the last change before returning the new value
function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return debounced
}

export function SearchBar({ value, onChange, onSearch, onSelectSuggestion }: SearchBarProps) {
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [isOpen, setIsOpen]           = useState(false)
  const [activeIdx, setActiveIdx]     = useState(-1)   // keyboard nav index
  const [isFetching, setIsFetching]   = useState(false)
  const inputRef                      = useRef<HTMLInputElement>(null)
  const containerRef                  = useRef<HTMLDivElement>(null)
  // useId() produces a stable ID that matches between SSR and client hydration,
  // unlike a static string which can cause React hydration mismatches.
  const uid        = useId()
  const inputId    = `${uid}-input`
  const listboxId  = `${uid}-listbox`

  const debouncedQuery = useDebounce(value, 250)

  // Fetch suggestions whenever the debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim().length < 2) {
      setSuggestions([])
      setIsOpen(false)
      return
    }

    let cancelled = false

    ;(async () => {
      setIsFetching(true)
      const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
      try {
        const res  = await fetch(`${API}/api/suggest?q=${encodeURIComponent(debouncedQuery)}`)
        const data = await res.json()
        if (!cancelled) {
          const s = data.suggestions ?? []
          setSuggestions(s)
          setIsOpen(s.length > 0)
          setActiveIdx(-1)
        }
      } catch {
        if (!cancelled) setSuggestions([])
      } finally {
        if (!cancelled) setIsFetching(false)
      }
    })()

    return () => { cancelled = true }
  }, [debouncedQuery])

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // Select a suggestion:
  // 1. Sync the input value
  // 2. Fire onSelectSuggestion(suggestion) — the parent calls doSearch(suggestion)
  //    directly, bypassing the stale `query` closure in the parent's onSearch handler.
  const selectSuggestion = useCallback(
    (suggestion: string) => {
      onChange(suggestion)
      setIsOpen(false)
      setSuggestions([])
      setActiveIdx(-1)
      if (onSelectSuggestion) {
        onSelectSuggestion(suggestion)
      } else {
        // Fallback: brief timeout lets React commit the state before onSearch reads it
        setTimeout(onSearch, 0)
      }
    },
    [onChange, onSearch, onSelectSuggestion]
  )

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === "Enter") { setIsOpen(false); onSearch() }
      return
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setActiveIdx((i) => (i < suggestions.length - 1 ? i + 1 : 0))
        break
      case "ArrowUp":
        e.preventDefault()
        setActiveIdx((i) => (i > 0 ? i - 1 : suggestions.length - 1))
        break
      case "Enter":
        e.preventDefault()
        if (activeIdx >= 0) selectSuggestion(suggestions[activeIdx])
        else { setIsOpen(false); onSearch() }
        break
      case "Escape":
        setIsOpen(false)
        setActiveIdx(-1)
        break
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setIsOpen(false)
    onSearch()
  }

  const handleClear = () => {
    onChange("")
    setSuggestions([])
    setIsOpen(false)
    setActiveIdx(-1)
    inputRef.current?.focus()
  }

  // Bold the characters in the suggestion that match the current query
  const highlightMatch = (text: string, query: string) => {
    const q = query.trim().toLowerCase()
    if (!q) return <span>{text}</span>
    const idx = text.toLowerCase().indexOf(q)
    if (idx === -1) return <span>{text}</span>
    return (
      <>
        <span>{text.slice(0, idx)}</span>
        <span className="font-semibold text-foreground">
          {text.slice(idx, idx + q.length)}
        </span>
        <span>{text.slice(idx + q.length)}</span>
      </>
    )
  }

  return (
    <div ref={containerRef} className="w-full max-w-3xl relative">
      <form onSubmit={handleSubmit}>
        <div className="flex items-center gap-2 p-2 bg-card border border-border rounded-xl shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center flex-1 gap-3 px-4">
            {/* Search icon pulses while fetching suggestions */}
            <Search
              className={`h-5 w-5 shrink-0 transition-colors ${
                isFetching ? "text-primary animate-pulse" : "text-muted-foreground"
              }`}
            />
            <input
              ref={inputRef}
              id={inputId}
              type="text"
              value={value}
              onChange={(e) => {
                onChange(e.target.value)
                if (e.target.value.trim().length >= 2) setIsOpen(true)
              }}
              onKeyDown={handleKeyDown}
              onFocus={() => { if (suggestions.length > 0) setIsOpen(true) }}
              placeholder="Search research papers, authors, or topics..."
              autoComplete="off"
              aria-autocomplete="list"
              aria-controls={listboxId}
              aria-expanded={isOpen}
              suppressHydrationWarning
              className="flex-1 bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none text-base md:text-lg py-3"
            />
            {/* Clear button */}
            {value && (
              <button
                type="button"
                onClick={handleClear}
                aria-label="Clear search"
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button type="submit" size="lg" className="px-6 md:px-8 rounded-lg">
            Search
          </Button>
        </div>
      </form>

      {/* ── Suggestions dropdown ─────────────────────────────────────────── */}
      {isOpen && suggestions.length > 0 && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Search suggestions"
          className="absolute top-full left-0 right-0 mt-1 z-50 bg-card border border-border rounded-xl shadow-lg overflow-hidden"
        >
          <ul>
            {suggestions.map((suggestion, idx) => (
              <li
                key={idx}
                role="option"
                aria-selected={idx === activeIdx}
                // mousedown fires before input blur, so we prevent default to keep focus
                onMouseDown={(e) => { e.preventDefault(); selectSuggestion(suggestion) }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`flex items-center gap-3 px-5 py-3 cursor-pointer text-sm transition-colors ${
                  idx === activeIdx
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Search className="h-3.5 w-3.5 shrink-0 opacity-40" />
                <span className="truncate">
                  {highlightMatch(suggestion, value)}
                </span>
              </li>
            ))}
          </ul>
          <div className="px-5 py-2 text-xs text-muted-foreground/60 border-t border-border bg-muted/20 flex justify-between">
            <span>↑↓ navigate</span>
            <span>↵ select</span>
            <span>Esc close</span>
          </div>
        </div>
      )}
    </div>
  )
}
