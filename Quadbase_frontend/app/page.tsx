"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { User, AlertCircle, Loader2, X } from "lucide-react"
import { SearchBar } from "@/components/search-bar"
import { ResultCard, type Paper } from "@/components/result-card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

const POPULAR_TERMS = ["neural networks", "reinforcement learning", "spiking", "optimization"]

// arXiv CS sub-categories available in the dataset
const CATEGORIES = [
  { label: "All",      value: "" },
  { label: "cs.AI",   value: "cs.AI" },
  { label: "cs.LG",   value: "cs.LG" },
  { label: "cs.NE",   value: "cs.NE" },
  { label: "cs.IR",   value: "cs.IR" },
  { label: "cs.CV",   value: "cs.CV" },
  { label: "cs.CL",   value: "cs.CL" },
  { label: "stat.ML", value: "stat.ML" },
]

export default function HomePage() {
  const [query, setQuery]           = useState("")
  const [results, setResults]       = useState<Paper[]>([])
  const [numFound, setNumFound]     = useState(0)
  const [hasSearched, setHasSearched] = useState(false)
  const [isLoading, setIsLoading]   = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState("")
  // Categories detected automatically from the query string by the backend
  const [detectedCategories, setDetectedCategories] = useState<string[]>([])

  const doSearch = useCallback(async (q: string, category = activeCategory) => {
    if (!q.trim()) return
    setIsLoading(true)
    setError(null)
    const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000) // 10s timeout
    try {
      const params = new URLSearchParams({
        q,
        rows: "20",
        ...(category ? { category } : {}),
      })
      const res = await fetch(`${API}/api/search?${params.toString()}`, {
        signal: controller.signal,
      })
      if (!res.ok) throw new Error(`Search failed (${res.status})`)
      const data = await res.json()
      setResults(data.docs ?? [])
      setNumFound(data.numFound ?? 0)
      setDetectedCategories(data._meta?.detectedCategories ?? [])
      setHasSearched(true)
    } catch (err) {
      const msg = err instanceof DOMException && err.name === "AbortError"
        ? "Search timed out — please try again"
        : err instanceof Error ? err.message : "Search failed"
      setError(msg)
      setResults([])
      setNumFound(0)
      setHasSearched(true)
    } finally {
      clearTimeout(timer)
      setIsLoading(false)
    }
  }, [activeCategory])

  const handleSelectSuggestion = (suggestion: string) => {
    setQuery(suggestion)
    doSearch(suggestion, activeCategory)
  }

  const handleSearch = () => doSearch(query)

  const handlePopular = (term: string) => {
    setQuery(term)
    doSearch(term)
  }

  const handleCategoryChange = (cat: string) => {
    setActiveCategory(cat)
    if (hasSearched && query.trim()) doSearch(query, cat)
  }

  const handleClear = () => {
    setQuery("")
    setResults([])
    setNumFound(0)
    setHasSearched(false)
    setError(null)
    setActiveCategory("")
    setDetectedCategories([])
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/" className="text-xl font-semibold text-foreground">
            QuadBase
          </Link>
          <Link href="/admin/login">
            <Button variant="ghost" size="sm" className="gap-2">
              <User className="h-4 w-4" />
              <span className="hidden sm:inline">Admin</span>
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero / Search Section */}
      <main className="max-w-6xl mx-auto px-4">
        <section
          className={`flex flex-col items-center transition-all duration-500 ${
            hasSearched ? "py-8" : "py-16 md:py-24"
          }`}
        >
          {!hasSearched && (
            <div className="text-center mb-8">
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold text-foreground tracking-tight text-balance">
                QuadBase
              </h1>
              <p className="mt-4 text-lg md:text-xl text-muted-foreground max-w-2xl text-pretty">
                Search research papers powered by Apache Solr. Fast, accurate, and always live.
              </p>
            </div>
          )}

          <SearchBar
            value={query}
            onChange={setQuery}
            onSearch={handleSearch}
            onSelectSuggestion={handleSelectSuggestion}
          />

          {/* Category filter pills — shown before and after search */}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => handleCategoryChange(cat.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  activeCategory === cat.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-muted-foreground border-border hover:border-primary hover:text-foreground"
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {!hasSearched && (
            <div className="mt-4 flex flex-wrap justify-center gap-2 text-sm text-muted-foreground">
              <span>Popular:</span>
              {POPULAR_TERMS.map((term) => (
                <button
                  key={term}
                  onClick={() => handlePopular(term)}
                  className="text-primary hover:underline"
                >
                  {term}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Results Section */}
        {hasSearched && (
          <section className="pb-16">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <p className="text-sm text-muted-foreground">
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                    </span>
                  ) : error ? (
                    <span className="flex items-center gap-2 text-destructive">
                      <AlertCircle className="h-4 w-4" /> {error}
                    </span>
                  ) : (
                    <>
                      Found <strong>{numFound}</strong> result{numFound !== 1 ? "s" : ""} for
                      &ldquo;{query}&rdquo;
                    </>
                  )}
                </p>

                {/* Show detected category tokens from the query */}
                {detectedCategories.length > 0 && (
                  <div className="flex gap-1 flex-wrap">
                    {detectedCategories.map((cat) => (
                      <Badge key={cat} variant="secondary" className="text-xs">
                        {cat}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Active category filter pill with dismiss */}
                {activeCategory && (
                  <button
                    onClick={() => handleCategoryChange("")}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 transition-colors"
                  >
                    {activeCategory} <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={handleClear}>
                Clear
              </Button>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : results.length > 0 ? (
              <div className="space-y-4">
                {results.map((paper) => (
                  <ResultCard key={paper.id} paper={paper} />
                ))}
              </div>
            ) : !error ? (
              <p className="text-center text-muted-foreground py-16">
                No results found for &ldquo;{query}&rdquo;
                {activeCategory && <> in <strong>{activeCategory}</strong></>}
              </p>
            ) : null}
          </section>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card/30 mt-auto">
        <div className="max-w-6xl mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          QuadBase · Powered by Apache Solr · eDisMax + BM25
        </div>
      </footer>
    </div>
  )
}
