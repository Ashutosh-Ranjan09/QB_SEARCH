"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

interface AuthContextType {
  isAuthenticated: boolean
  isInitializing: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isInitializing, setIsInitializing] = useState(true)

  useEffect(() => {
    // Restore session from stored JWT token
    const token = localStorage.getItem("quadbase_admin_token")
    if (token) {
      setIsAuthenticated(true)
    }
    setIsInitializing(false)
  }, [])

  /**
   * Sends credentials to the Express backend (/api/login).
   * On success, stores the JWTs in localStorage and marks the user as authenticated.
   * Throws an Error with a human-readable message on failure.
   */
  const login = async (username: string, password: string): Promise<void> => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"

    const res = await fetch(`${apiUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })

    if (!res.ok) {
      let message = "Invalid credentials"
      try {
        const data = await res.json()
        if (data?.error) message = data.error
      } catch {
        // ignore parse failures
      }
      throw new Error(message)
    }

    const { token, refreshToken } = await res.json()
    localStorage.setItem("quadbase_admin_token", token)
    localStorage.setItem("quadbase_admin_refresh_token", refreshToken)
    setIsAuthenticated(true)
  }

  const logout = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
      const refreshToken = localStorage.getItem("quadbase_admin_refresh_token")
      // Revoke the token in the database
      await fetch(`${apiUrl}/api/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      })
    } catch {
      // Ignore network errors on logout
    } finally {
      setIsAuthenticated(false)
      localStorage.removeItem("quadbase_admin_token")
      localStorage.removeItem("quadbase_admin_refresh_token")
    }
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, isInitializing, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

/**
 * A customized fetch wrapper designed for protected routes.
 * It reads the token from localStorage automatically.
 * If a 401 or 403 occurs, it transparently intercepts the error, 
 * hits `/api/refresh` with the refreshToken to fetch a new token, 
 * stores it, and retries the original request identically.
 */
export async function apiFetch(endpoint: string, init?: RequestInit): Promise<Response> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"
  let token = localStorage.getItem("quadbase_admin_token")

  const headers = new Headers(init?.headers)
  if (token) headers.set("Authorization", token)

  let res = await fetch(`${apiUrl}${endpoint}`, { ...init, headers })

  if (res.status === 401 || res.status === 403) {
    const refreshToken = localStorage.getItem("quadbase_admin_refresh_token")
    if (refreshToken) {
      const refreshRes = await fetch(`${apiUrl}/api/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken })
      })

      if (refreshRes.ok) {
        // Server rotates the token pair — save both new tokens
        const { token: newToken, refreshToken: newRefreshToken } = await refreshRes.json()
        localStorage.setItem("quadbase_admin_token", newToken)
        if (newRefreshToken) localStorage.setItem("quadbase_admin_refresh_token", newRefreshToken)
        
        // Retry original request seamlessly
        headers.set("Authorization", newToken)
        res = await fetch(`${apiUrl}${endpoint}`, { ...init, headers })
      } else {
         // The 7d refresh token also expired. Force Hard Logout.
         localStorage.removeItem("quadbase_admin_token")
         localStorage.removeItem("quadbase_admin_refresh_token")
         window.location.href = "/admin/login"
      }
    } else {
        localStorage.removeItem("quadbase_admin_token")
        window.location.href = "/admin/login"
    }
  }

  return res;
}
