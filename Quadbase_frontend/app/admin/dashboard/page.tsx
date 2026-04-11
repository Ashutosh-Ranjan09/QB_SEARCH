"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { LogOut, Trash2, Upload, List, Loader2, AlertCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/lib/auth-context"
import type { Paper } from "@/components/result-card"

export default function AdminDashboardPage() {
  const { isAuthenticated, logout } = useAuth()
  const router = useRouter()

  const [papers, setPapers] = useState<Paper[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)

  const [formData, setFormData] = useState({
    id: "",
    title: "",
    authors: "",
    categories: "",
    abstract: "",
  })
  const [uploadLoading, setUploadLoading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push("/admin/login")
    }
  }, [isAuthenticated, router])

  const fetchPapers = useCallback(async () => {
    setListLoading(true)
    setListError(null)
    const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
    try {
      const res = await fetch(`${API}/api/papers`)
      if (!res.ok) throw new Error(`Failed to fetch papers (${res.status})`)
      const data = await res.json()
      setPapers(data.docs ?? [])
    } catch (err) {
      setListError(err instanceof Error ? err.message : "Failed to load papers")
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => {
    if (isAuthenticated) fetchPapers()
  }, [isAuthenticated, fetchPapers])

  const handleLogout = () => {
    logout()
    router.push("/admin/login")
  }

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    setUploadLoading(true)
    setUploadError(null)
    setUploadSuccess(false)

    try {
      const token = sessionStorage.getItem("quadbase_admin_token") ?? ""
      const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
      const payload = {
        id: formData.id || undefined,
        title: formData.title,
        authors: formData.authors.split(",").map((a) => a.trim()).filter(Boolean),
        categories: formData.categories.split(",").map((c) => c.trim()).filter(Boolean),
        abstract: formData.abstract,
      }

      const res = await fetch(`${API}/api/papers`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": token,
        },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `Upload failed (${res.status})`)
      }

      setFormData({ id: "", title: "", authors: "", categories: "", abstract: "" })
      setUploadSuccess(true)
      setTimeout(() => setUploadSuccess(false), 4000)
      await fetchPapers()
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed")
    } finally {
      setUploadLoading(false)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
    try {
      const token = sessionStorage.getItem("quadbase_admin_token") ?? ""
      const res = await fetch(`${API}/api/papers/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Authorization": token },
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || `Delete failed (${res.status})`)
      }
      setPapers((prev) => prev.filter((p) => p.id !== id))
    } catch (err) {
      alert(err instanceof Error ? err.message : "Delete failed")
    } finally {
      setDeletingId(null)
    }
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-xl font-semibold text-foreground">
              QuadBase
            </Link>
            <Badge variant="secondary" className="hidden sm:inline-flex">
              Admin
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="gap-2"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-6">
          Admin Dashboard
        </h1>

        <Tabs defaultValue="upload" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2 mb-6">
            <TabsTrigger value="upload" className="gap-2">
              <Upload className="h-4 w-4" />
              Upload Paper
            </TabsTrigger>
            <TabsTrigger value="manage" className="gap-2">
              <List className="h-4 w-4" />
              Manage Papers
            </TabsTrigger>
          </TabsList>

          {/* Upload Paper Tab */}
          <TabsContent value="upload">
            <Card>
              <CardHeader>
                <CardTitle>Upload Paper</CardTitle>
                <CardDescription>
                  Add a new research paper to the Solr index
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleUpload} className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="id">Paper ID (optional)</Label>
                      <Input
                        id="id"
                        name="id"
                        value={formData.id}
                        onChange={handleInputChange}
                        placeholder="e.g., 2401.00001 (auto-generated if blank)"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="categories">Categories</Label>
                      <Input
                        id="categories"
                        name="categories"
                        value={formData.categories}
                        onChange={handleInputChange}
                        placeholder="cs.IR, cs.CL (comma-separated)"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="title">Title</Label>
                    <Input
                      id="title"
                      name="title"
                      value={formData.title}
                      onChange={handleInputChange}
                      placeholder="Paper title"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="authors">Authors</Label>
                    <Input
                      id="authors"
                      name="authors"
                      value={formData.authors}
                      onChange={handleInputChange}
                      placeholder="Author names (comma-separated)"
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="abstract">Abstract</Label>
                    <Textarea
                      id="abstract"
                      name="abstract"
                      value={formData.abstract}
                      onChange={handleInputChange}
                      placeholder="Paper abstract..."
                      rows={6}
                      required
                    />
                  </div>

                  <div className="flex items-center gap-4 flex-wrap">
                    <Button
                      type="submit"
                      className="gap-2"
                      disabled={uploadLoading}
                    >
                      {uploadLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      {uploadLoading ? "Indexing…" : "Upload to Solr"}
                    </Button>
                    {uploadSuccess && (
                      <span className="text-sm text-primary">
                        ✓ Paper indexed in Solr successfully!
                      </span>
                    )}
                    {uploadError && (
                      <span className="text-sm text-destructive flex items-center gap-1">
                        <AlertCircle className="h-4 w-4" /> {uploadError}
                      </span>
                    )}
                  </div>
                </form>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Manage Papers Tab */}
          <TabsContent value="manage">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Manage Papers</CardTitle>
                    <CardDescription>
                      View and manage papers indexed in Solr
                      {papers.length > 0 && (
                        <span className="ml-2 text-foreground font-medium">
                          ({papers.length} total)
                        </span>
                      )}
                    </CardDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchPapers}
                    disabled={listLoading}
                    className="gap-2"
                  >
                    <RefreshCw
                      className={`h-4 w-4 ${listLoading ? "animate-spin" : ""}`}
                    />
                    Refresh
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {listLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : listError ? (
                  <div className="flex flex-col items-center gap-3 py-12 text-destructive">
                    <AlertCircle className="h-8 w-8" />
                    <p className="text-sm">{listError}</p>
                    <Button variant="outline" size="sm" onClick={fetchPapers}>
                      Retry
                    </Button>
                  </div>
                ) : papers.length === 0 ? (
                  <p className="text-center text-muted-foreground py-12">
                    No papers indexed in Solr yet
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">ID</TableHead>
                          <TableHead>Title</TableHead>
                          <TableHead className="hidden md:table-cell">
                            Authors
                          </TableHead>
                          <TableHead className="hidden sm:table-cell">
                            Categories
                          </TableHead>
                          <TableHead className="w-[80px] text-right">
                            Actions
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {papers.map((paper) => (
                          <TableRow key={paper.id}>
                            <TableCell className="font-mono text-sm">
                              {paper.id}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate font-medium">
                              {paper.title}
                            </TableCell>
                            <TableCell className="hidden md:table-cell text-muted-foreground">
                              {paper.authors.length > 0
                                ? paper.authors.slice(0, 2).join(", ") +
                                  (paper.authors.length > 2
                                    ? ` +${paper.authors.length - 2}`
                                    : "")
                                : "—"}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">
                              {paper.categories.length > 0 ? (
                                <div className="flex flex-wrap gap-1">
                                  {paper.categories.slice(0, 2).map((cat) => (
                                    <Badge
                                      key={cat}
                                      variant="secondary"
                                      className="text-xs"
                                    >
                                      {cat}
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleDelete(paper.id)}
                                disabled={deletingId === paper.id}
                                className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              >
                                {deletingId === paper.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                                <span className="sr-only">Delete paper</span>
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  )
}
