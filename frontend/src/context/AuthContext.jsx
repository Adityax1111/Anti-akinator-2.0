// /frontend/src/context/AuthContext.jsx
import React, { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import api from '../api/axios';

const AuthContext = createContext();

const SESSION_TIMEOUT = 7 * 24 * 60 * 60 * 1000;

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [authError, setAuthError] = useState(null);
  const [sessionExpiry, setSessionExpiry] = useState(null);
  
  const fetchUserRef = useRef(false);
  const sessionTimerRef = useRef(null);
  const initialFetchDone = useRef(false);

  // ===== SET AUTH HEADER =====
  const setAuthHeader = useCallback((token) => {
    if (token) {
      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    } else {
      delete api.defaults.headers.common['Authorization'];
    }
  }, []);

  // ===== LOGOUT =====
  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout').catch(() => {});
    } catch (error) {
      // Ignore
    } finally {
      if (sessionTimerRef.current) {
        clearTimeout(sessionTimerRef.current);
        sessionTimerRef.current = null;
      }
      
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      delete api.defaults.headers.common['Authorization'];
      
      setToken(null);
      setUser(null);
      setAuthError(null);
      setSessionExpiry(null);
      
    }
  }, []);

  // ===== SESSION MANAGEMENT =====
  const resetSessionTimer = useCallback(() => {
    if (sessionTimerRef.current) {
      clearTimeout(sessionTimerRef.current);
    }
    
    if (user && token) {
      const expiry = new Date(Date.now() + SESSION_TIMEOUT);
      setSessionExpiry(expiry);
      
      sessionTimerRef.current = setTimeout(() => {
        logout();
      }, SESSION_TIMEOUT);
    }
  }, [user, token, logout]);

  // ===== TRACK USER ACTIVITY =====
  useEffect(() => {
    if (!user) return;
    
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    const resetTimer = () => resetSessionTimer();
    
    events.forEach(event => document.addEventListener(event, resetTimer));
    resetSessionTimer();
    
    return () => {
      events.forEach(event => document.removeEventListener(event, resetTimer));
      if (sessionTimerRef.current) clearTimeout(sessionTimerRef.current);
    };
  }, [user, resetSessionTimer]);

  // ============================================================
  // ===== FETCH USER (ONLY ONCE) =====
  // ============================================================
  const fetchUser = useCallback(async () => {
    if (fetchUserRef.current) return;
    fetchUserRef.current = true;

    try {
      const response = await api.get('/auth/me');
      const userData = response.data.user;
      
      // ✅ Ensure user has _id (for payment system)
      if (userData) {
        if (!userData._id && userData.id) {
          userData._id = userData.id;
        }
        // Ensure shards field exists
        if (userData.shards === undefined) {
          userData.shards = 0;
        }
        // Ensure seasonPass field exists
        if (!userData.seasonPass) {
          userData.seasonPass = {
            active: false,
            expiresAt: null,
            currentTier: 1,
            progress: 0
          };
        }
        // Ensure transactionHistory exists
        if (!userData.transactionHistory) {
          userData.transactionHistory = [];
        }
      }
      
      setUser(userData);
      setAuthError(null);
      resetSessionTimer();
      
      // ✅ Store in localStorage with all fields
      localStorage.setItem('user', JSON.stringify(userData));
      
      return userData;
    } catch (error) {
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        delete api.defaults.headers.common['Authorization'];
        setToken(null);
        setUser(null);
      } else {
        setAuthError('Unable to fetch user data. Please try refreshing.');
      }
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, [logout, resetSessionTimer]);

  // ===== REFRESH USER =====
  const refreshUser = useCallback(async () => {
    if (!token) {
      setUser(null);
      return null;
    }
    
    fetchUserRef.current = false;
    setLoading(true);
    const userData = await fetchUser();
    setLoading(false);
    return userData;
  }, [token, fetchUser]);

  // ===== INITIALIZE AUTH =====
  useEffect(() => {
    if (initialFetchDone.current) return;
    initialFetchDone.current = true;
    
    // ✅ Try to restore user from localStorage
    const storedUser = localStorage.getItem('user');
    if (storedUser && !user) {
      try {
        const parsedUser = JSON.parse(storedUser);
        // Ensure _id exists
        if (parsedUser && !parsedUser._id && parsedUser.id) {
          parsedUser._id = parsedUser.id;
        }
        setUser(parsedUser);
      } catch (e) {
      }
    }
    
    if (token) {
      setAuthHeader(token);
      fetchUser();
    } else {
      setLoading(false);
    }
  }, [token, setAuthHeader, fetchUser]);

  // ============================================================
  // ===== LOGIN =====
  // ============================================================
  const login = useCallback(async (email, password) => {
    setAuthError(null);
    
    if (!email || !password) {
      return {
        success: false,
        message: 'Email and password are required'
      };
    }

    try {
      const response = await api.post('/auth/login', { 
        email: email.trim().toLowerCase(), 
        password: password.trim() 
      });
      
      const data = response.data;

      if (data.requires2FA) {
        return {
          success: true,
          requires2FA: true,
          email: data.email,
          userId: data.userId,
          message: '2FA verification required'
        };
      }

      const { token, user } = data;
      
      if (!token || !user) {
        throw new Error('Invalid response from server');
      }
      
      // ✅ Ensure user has _id and all required fields
      if (user) {
        if (!user._id && user.id) {
          user._id = user.id;
        }
        if (user.shards === undefined) {
          user.shards = 0;
        }
        if (!user.seasonPass) {
          user.seasonPass = {
            active: false,
            expiresAt: null,
            currentTier: 1,
            progress: 0
          };
        }
        if (!user.transactionHistory) {
          user.transactionHistory = [];
        }
      }
      
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      setToken(token);
      setAuthHeader(token);
      setUser(user);
      setAuthError(null);
      resetSessionTimer();
      
      fetchUserRef.current = false;
      
      
      return { 
        success: true,
        user: user
      };
    } catch (error) {
      
      let message = 'Login failed. Please try again.';
      
      if (error.response) {
        switch (error.response.status) {
          case 400:
            message = error.response.data?.message || 'Invalid email or password';
            break;
          case 401:
            message = error.response.data?.message || 'Invalid credentials';
            break;
          case 423:
            message = error.response.data?.message || 'Account is locked. Please try again later.';
            break;
          case 429:
            message = 'Too many login attempts. Please wait 15 minutes.';
            break;
          case 500:
            message = 'Server error. Please try again later.';
            break;
          default:
            message = error.response.data?.message || message;
        }
      } else if (error.message?.includes('Network')) {
        message = 'Network error. Please check your connection.';
      }
      
      setAuthError(message);
      
      return {
        success: false,
        message: message
      };
    }
  }, [setAuthHeader, resetSessionTimer]);

  // ============================================================
  // ===== REGISTER =====
  // ============================================================
  const register = useCallback(async (userData) => {
    setAuthError(null);
    
    const { username, email, password, referralCode, deviceFingerprint } = userData;
    
    if (!username || !email || !password) {
      return {
        success: false,
        message: 'All fields are required'
      };
    }

    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(username)) {
      return {
        success: false,
        message: 'Username can only contain letters, numbers, and underscores'
      };
    }

    if (username.length < 3 || username.length > 20) {
      return {
        success: false,
        message: 'Username must be 3-20 characters'
      };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        success: false,
        message: 'Please enter a valid email address'
      };
    }

    if (password.length < 6) {
      return {
        success: false,
        message: 'Password must be at least 6 characters'
      };
    }

    if (!/[A-Z]/.test(password)) {
      return {
        success: false,
        message: 'Password must contain at least one uppercase letter'
      };
    }

    if (!/[0-9]/.test(password)) {
      return {
        success: false,
        message: 'Password must contain at least one number'
      };
    }

    const requestData = {
      username: username.trim(),
      email: email.trim().toLowerCase(),
      password: password.trim(),
      deviceFingerprint: deviceFingerprint || null
    };

    if (referralCode && referralCode.trim() !== '' && referralCode !== 'undefined') {
      requestData.referralCode = referralCode.trim().toUpperCase();
    } else {
    }


    try {
      const response = await api.post('/auth/register', requestData);
      
      const data = response.data;

      if (data.requiresVerification) {
        return {
          success: true,
          requiresVerification: true,
          email: data.email,
          userId: data.userId,
          message: data.message || 'Please verify your email'
        };
      }

      const { token, user } = data;
      
      if (!token || !user) {
        throw new Error('Invalid response from server');
      }
      
      // ✅ Ensure user has _id and all required fields
      if (user) {
        if (!user._id && user.id) {
          user._id = user.id;
        }
        if (user.shards === undefined) {
          user.shards = 0;
        }
        if (!user.seasonPass) {
          user.seasonPass = {
            active: false,
            expiresAt: null,
            currentTier: 1,
            progress: 0
          };
        }
        if (!user.transactionHistory) {
          user.transactionHistory = [];
        }
      }
      
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      setToken(token);
      setAuthHeader(token);
      setUser(user);
      setAuthError(null);
      resetSessionTimer();
      
      fetchUserRef.current = false;
      
      
      return {
        success: true,
        user: user,
        message: data.message
      };
    } catch (error) {
      
      let message = 'Registration failed. Please try again.';
      
      if (error.response) {
        switch (error.response.status) {
          case 400:
            message = error.response.data?.message || 'Invalid registration data';
            break;
          case 409:
            message = error.response.data?.message || 'User already exists with this email or username';
            break;
          case 429:
            message = error.response.data?.message || 'Too many registration attempts. Please wait.';
            break;
          case 500:
            message = 'Server error. Please try again later.';
            break;
          default:
            message = error.response.data?.message || message;
        }
      } else if (error.message?.includes('Network')) {
        message = 'Network error. Please check your connection.';
      }
      
      setAuthError(message);
      
      return {
        success: false,
        message: message
      };
    }
  }, [setAuthHeader, resetSessionTimer]);

  // ============================================================
  // ===== VERIFY OTP =====
  // ============================================================
  const verifyOTP = useCallback(async (email, otp) => {
    setAuthError(null);
    setLoading(true);

    try {
      const response = await api.post('/auth/verify-otp', { email, otp });
      
      const { token, user } = response.data;
      
      if (!token || !user) {
        throw new Error('Invalid response from server');
      }
      
      // ✅ Ensure user has _id and all required fields
      if (user) {
        if (!user._id && user.id) {
          user._id = user.id;
        }
        if (user.shards === undefined) {
          user.shards = 0;
        }
        if (!user.seasonPass) {
          user.seasonPass = {
            active: false,
            expiresAt: null,
            currentTier: 1,
            progress: 0
          };
        }
        if (!user.transactionHistory) {
          user.transactionHistory = [];
        }
      }
      
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      setToken(token);
      setAuthHeader(token);
      setUser(user);
      setAuthError(null);
      resetSessionTimer();
      
      fetchUserRef.current = false;
      
      
      return {
        success: true,
        user: user,
        message: response.data.message
      };
    } catch (error) {
      
      let message = 'Failed to verify OTP. Please try again.';
      
      if (error.response) {
        switch (error.response.status) {
          case 400:
            message = error.response.data?.message || 'Invalid OTP';
            break;
          case 404:
            message = error.response.data?.message || 'No pending verification found';
            break;
          case 429:
            message = 'Too many attempts. Please try again later.';
            break;
          default:
            message = error.response.data?.message || message;
        }
      }
      
      setAuthError(message);
      
      return {
        success: false,
        message: message
      };
    } finally {
      setLoading(false);
    }
  }, [setAuthHeader, resetSessionTimer]);

  // ============================================================
  // ===== RESEND OTP =====
  // ============================================================
  const resendOTP = useCallback(async (email) => {
    setAuthError(null);
    setLoading(true);

    try {
      const response = await api.post('/auth/resend-otp', { email });
      
      return {
        success: true,
        message: response.data.message || 'New OTP sent to your email'
      };
    } catch (error) {
      
      let message = 'Failed to resend OTP. Please try again.';
      
      if (error.response) {
        switch (error.response.status) {
          case 429:
            message = error.response.data?.message || 'Please wait 60 seconds before requesting another OTP';
            break;
          case 404:
            message = error.response.data?.message || 'User not found';
            break;
          default:
            message = error.response.data?.message || message;
        }
      }
      
      setAuthError(message);
      
      return {
        success: false,
        message: message
      };
    } finally {
      setLoading(false);
    }
  }, []);

  // ============================================================
  // ===== UPDATE USER DATA =====
  // ============================================================
  const updateUser = useCallback((updatedData) => {
    if (!user) return null;
    
    const newUser = { ...user, ...updatedData };
    setUser(newUser);
    localStorage.setItem('user', JSON.stringify(newUser));
    return newUser;
  }, [user]);

  // ============================================================
  // ===== UPDATE SHARDS =====
  // ============================================================
  const updateShards = useCallback((newShardCount) => {
    if (!user) return null;
    
    const newUser = { 
      ...user, 
      shards: newShardCount 
    };
    setUser(newUser);
    localStorage.setItem('user', JSON.stringify(newUser));
    return newUser;
  }, [user]);

  // ============================================================
  // ===== UPDATE SEASON PASS =====
  // ============================================================
  const updateSeasonPass = useCallback((seasonPassData) => {
    if (!user) return null;
    
    const newUser = { 
      ...user, 
      seasonPass: { ...user.seasonPass, ...seasonPassData }
    };
    setUser(newUser);
    localStorage.setItem('user', JSON.stringify(newUser));
    return newUser;
  }, [user]);

  // ===== CLEAR ERROR =====
  const clearError = useCallback(() => {
    setAuthError(null);
  }, []);

  // ===== CHECK AUTH STATUS =====
  const isAuthenticated = useCallback(() => {
    return !!user && !!token;
  }, [user, token]);

  // ===== GET AUTH HEADER =====
  const getAuthHeader = useCallback(() => {
    return token ? `Bearer ${token}` : null;
  }, [token]);

  // ===== SESSION INFO =====
  const getSessionTimeLeft = useCallback(() => {
    if (!sessionExpiry) return 0;
    return Math.max(0, sessionExpiry.getTime() - Date.now());
  }, [sessionExpiry]);

  const value = {
    user,
    loading,
    token,
    authError,
    sessionExpiry,
    login,
    register,
    verifyOTP,
    resendOTP,
    logout,
    refreshUser,
    clearError,
    isAuthenticated: isAuthenticated(),
    getAuthHeader,
    getSessionTimeLeft,
    setUser,
    updateUser,
    updateShards,
    updateSeasonPass
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;