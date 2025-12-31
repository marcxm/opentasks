// Authentication service
import api from './api';

export interface User {
  id: number;
  username: string;
  email?: string;
}

export interface LoginResponse {
  token: string;
  user: User;
}

// Login user
export const login = async (username: string, password: string): Promise<LoginResponse> => {
  try {
    const response = await api.post('/auth/login', { username, password });
    const data = response.data;
    
    // Store token in localStorage
    localStorage.setItem('authToken', data.token);
    
    return data;
  } catch (error: any) {
    throw new Error(error.response?.data?.error || 'Login failed');
  }
};

// Register user
export const register = async (username: string, password: string, email?: string): Promise<LoginResponse> => {
  try {
    const response = await api.post('/auth/register', { username, password, email });
    const data = response.data;
    
    // Store token in localStorage
    localStorage.setItem('authToken', data.token);
    
    return data;
  } catch (error: any) {
    throw new Error(error.response?.data?.error || 'Registration failed');
  }
};

// Logout user
export const logout = (): void => {
  localStorage.removeItem('authToken');
};

// Get current user
export const getCurrentUser = async (): Promise<User | null> => {
  const token = localStorage.getItem('authToken');
  if (!token) {
    return null;
  }

  try {
    const response = await api.get('/auth/me');
    return response.data;
  } catch (error: any) {
    console.error('Failed to get current user:', error);
    // Token is invalid, remove it
    if (error.response?.status === 401) {
      localStorage.removeItem('authToken');
    }
    return null;
  }
};

// Check if user is authenticated
export const isAuthenticated = (): boolean => {
  return localStorage.getItem('authToken') !== null;
};
