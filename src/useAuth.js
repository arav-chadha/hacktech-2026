import { useEffect, useState } from "react";

export function useAuth() {
  const [email, setEmail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    signIn();
  }, []);

  function getStoredUser() {
    return new Promise((resolve) => {
      chrome.storage.local.get("userEmail", (data) => {
        resolve(data.userEmail || null);
      });
    });
  }

  function trySilentAuth() {
    return new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        resolve(token || null);
      });
    });
  }

  function getUserInfo(token) {
    return fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: {
        Authorization: "Bearer " + token,
      },
    }).then((res) => res.json());
  }

  function interactiveSignIn() {
    return new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, async (token) => {
        if (chrome.runtime.lastError || !token) {
          reject(chrome.runtime.lastError);
          return;
        }

        try {
          const user = await getUserInfo(token);

          chrome.storage.local.set({ userEmail: user.email });

          resolve(user.email);
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  async function signIn() {
    try {
      // 1. Check storage
      const storedEmail = await getStoredUser();
      if (storedEmail) {
        setEmail(storedEmail);
        setLoading(false);
        return;
      }

      // 2. Try silent auth
      const token = await trySilentAuth();
      if (token) {
        const user = await getUserInfo(token);

        chrome.storage.local.set({ userEmail: user.email });
        setEmail(user.email);
        setLoading(false);
        return;
      }

      // 3. Interactive fallback
      const email = await interactiveSignIn();
      setEmail(email);
    } catch (err) {
      console.error("Auth error:", err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    if (email) {
      chrome.identity.removeCachedAuthToken({ token: email }, () => {
        chrome.storage.local.remove("userEmail");
        setEmail(null);
      });
    } 
    else {
      chrome.storage.local.remove("userEmail");
      setEmail(null);
    }
  }

  return {
    email,
    loading,
    error,
    signIn,
    logout
  };
}