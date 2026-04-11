"use client"

import { createContext, useContext, useState, useEffect, type ReactNode } from "react"

interface AuthContextType {
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)

  useEffect(() => {
    // Restore session from stored JWT token
    const token = sessionStorage.getItem("quadbase_admin_token")
    if (token) {
      setIsAuthenticated(true)
    }
  }, [])

  /**
   * Sends credentials to the Express backend (/api/login).
   * On success, stores the JWT in sessionStorage and marks the user as authenticated.
   * Throws an Error with a human-readable message on failure.
   */
  const login = async (username: string, password: string): Promise<void> => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001"

    const res = await fetch(`${apiUrl}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The Express backend only checks the password field
      body: JSON.stringify({ username, password }),
    })

    if (!res.ok) {
      // Surface the backend error message for display in the login form
      let message = "Invalid credentials"
      try {
        const data = await res.json()
        if (data?.error) message = data.error
      } catch {
        // ignore parse failures
      }
      throw new Error(message)
    }

    const { token } = await res.json()
    sessionStorage.setItem("quadbase_admin_token", token)
    setIsAuthenticated(true)
  }

  const logout = () => {
    setIsAuthenticated(false)
    sessionStorage.removeItem("quadbase_admin_token")
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, login, logout }}>
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
