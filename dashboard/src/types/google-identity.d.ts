declare global {
  type GoogleTokenResponse = {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  type GoogleTokenClient = {
    requestAccessToken(options?: {
      prompt?: string;
    }): void;
  };

  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void | Promise<void>;
            error_callback?: (error: { type?: string; message?: string }) => void;
          }): GoogleTokenClient;
        };
      };
    };
  }
}

export {};
