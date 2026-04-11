"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"

export interface Paper {
  id: string
  title: string
  authors: string[]
  categories: string[]
  abstract: string
}

interface ResultCardProps {
  paper: Paper
}

export function ResultCard({ paper }: ResultCardProps) {
  const [expanded, setExpanded] = useState(false)

  const truncatedAbstract = paper.abstract.length > 200 
    ? paper.abstract.slice(0, 200) + "..." 
    : paper.abstract

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <h3 className="text-lg md:text-xl font-semibold text-foreground leading-tight text-balance">
          {paper.title}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {paper.authors.join(", ")}
        </p>
        <div className="flex flex-wrap gap-2 mt-3">
          {paper.categories.map((category) => (
            <Badge key={category} variant="secondary" className="text-xs">
              {category}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <p className="text-sm text-muted-foreground leading-relaxed">
          {expanded ? paper.abstract : truncatedAbstract}
        </p>
        {paper.abstract.length > 200 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="mt-3 text-primary hover:text-primary/80 px-0"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" />
                Show Less
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" />
                View Full Abstract
              </>
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  )
}
