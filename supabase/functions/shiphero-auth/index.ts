// Supabase Edge Function: shiphero-auth
// Handles ShipHero authentication (OAuth login, token refresh, and developer tokens)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";

// =============================================================================
// TYPES
// =============================================================================

interface LoginRequest {
  username: string;
  password: string;
}

interface RefreshRequest {
  refresh: true;
}

interface DeveloperTokenRequest {
  developer_token: string;
  refresh_token?: string; // Optional refresh token to store
}

interface RefreshWithTokenRequest {
  refresh_token_direct: string; // Refresh token provided directly
}

interface GetCredentialsRequest {
  get_credentials: true; // Request to retrieve stored credentials
}

type AuthRequest = LoginRequest | RefreshRequest | DeveloperTokenRequest | RefreshWithTokenRequest | GetCredentialsRequest;

interface ShipHeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // seconds until expiration
}

interface ShipHeroGraphQLResponse<T> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: {
      code?: string;
      status?: number;
    };
  }>;
}

interface LoginMutationData {
  access_token: {
    request_new_access_token: ShipHeroTokenResponse;
  };
}

interface RefreshMutationData {
  access_token: {
    refresh_token: ShipHeroTokenResponse;
  };
}

interface AccountQueryData {
  account: {
    data: {
      id: string;
      email: string;
    };
    request_id: string;
  };
}

// =============================================================================
// CUSTOM ERROR CLASSES
// =============================================================================

class AuthenticationRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationRequiredError";
  }
}

class ShipHeroAPIError extends Error {
  statusCode: number;
  
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ShipHeroAPIError";
    this.statusCode = statusCode;
  }
}

// =============================================================================
// CONSTANTS
// =============================================================================

const SHIPHERO_GRAPHQL_URL = "https://public-api.shiphero.com/graphql";
const SHIPHERO_AUTH_TOKEN_URL = "https://public-api.shiphero.com/auth/token";
const SHIPHERO_AUTH_REFRESH_URL = "https://public-api.shiphero.com/auth/refresh";

// Developer tokens don't expire (or have very long expiry)
const DEVELOPER_TOKEN_EXPIRY_DAYS = 365;

// =============================================================================
// GRAPHQL QUERIES & MUTATIONS
// =============================================================================

const LOGIN_MUTATION = `
  mutation RequestAccessToken($email: String!, $password: String!) {
    access_token {
      request_new_access_token(email: $email, password: $password) {
        access_token
        refresh_token
        expires_in
      }
    }
  }
`;

const REFRESH_TOKEN_MUTATION = `
  mutation RefreshAccessToken($refreshToken: String!) {
    access_token {
      refresh_token(refresh_token: $refreshToken) {
        access_token
        refresh_token
        expires_in
      }
    }
  }
`;

// Simple query to validate token and get account info
// ShipHero wraps results in a 'data' field
const ACCOUNT_QUERY = `
  query GetAccount {
    account {
      data {
        id
        email
      }
      request_id
    }
  }
`;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Check if the request is a refresh request
 */
function isRefreshRequest(body: AuthRequest): body is RefreshRequest {
  return "refresh" in body && body.refresh === true;
}

/**
 * Check if the request is a login request
 */
function isLoginRequest(body: AuthRequest): body is LoginRequest {
  return "username" in body && "password" in body;
}

/**
 * Check if the request is a developer token request
 */
function isDeveloperTokenRequest(body: AuthRequest): body is DeveloperTokenRequest {
  return "developer_token" in body && typeof body.developer_token === "string";
}

/**
 * Check if the request is a direct refresh token request
 */
function isRefreshWithTokenRequest(body: AuthRequest): body is RefreshWithTokenRequest {
  return "refresh_token_direct" in body && typeof body.refresh_token_direct === "string";
}

/**
 * Check if the request is a get credentials request
 */
function isGetCredentialsRequest(body: AuthRequest): body is GetCredentialsRequest {
  return "get_credentials" in body && body.get_credentials === true;
}

/**
 * Call ShipHero GraphQL API
 */
async function callShipHeroAPI<T>(
  query: string,
  variables: Record<string, unknown>,
  accessToken?: string
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Add authorization header if we have an access token
  if (accessToken) {
    headers["Authorization"] = `Bearer ${accessToken}`;
  }

  console.log("Calling ShipHero API...");
  console.log("Headers:", JSON.stringify({ ...headers, Authorization: headers.Authorization ? "Bearer [REDACTED]" : undefined }));

  const response = await fetch(SHIPHERO_GRAPHQL_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query,
      variables,
    }),
  });

  // Get response body for debugging
  const responseText = await response.text();
  console.log("ShipHero response status:", response.status);
  console.log("ShipHero response body:", responseText.substring(0, 500));

  // Check for HTTP-level errors
  if (response.status === 401 || response.status === 403) {
    throw new AuthenticationRequiredError(
      `ShipHero API returned ${response.status}. Token may be invalid or expired. Response: ${responseText.substring(0, 200)}`
    );
  }

  if (!response.ok) {
    throw new ShipHeroAPIError(
      `ShipHero API request failed: ${response.statusText}. Response: ${responseText.substring(0, 200)}`,
      response.status
    );
  }

  let result: ShipHeroGraphQLResponse<T>;
  try {
    result = JSON.parse(responseText);
  } catch {
    throw new ShipHeroAPIError(`Failed to parse ShipHero response: ${responseText.substring(0, 200)}`, 500);
  }

  // Check for GraphQL-level errors
  if (result.errors && result.errors.length > 0) {
    const error = result.errors[0];
    const statusCode = error.extensions?.status || 500;
    const errorCode = error.extensions?.code || "UNKNOWN";
    
    console.log("GraphQL error:", JSON.stringify(error));
    
    // Check if the error indicates authentication failure
    if (
      statusCode === 401 || 
      statusCode === 403 || 
      errorCode === "UNAUTHENTICATED" ||
      errorCode === "FORBIDDEN" ||
      error.message.toLowerCase().includes("unauthorized") ||
      error.message.toLowerCase().includes("invalid token") ||
      error.message.toLowerCase().includes("expired")
    ) {
      throw new AuthenticationRequiredError(
        `ShipHero authentication failed: ${error.message}`
      );
    }
    
    throw new ShipHeroAPIError(
      `ShipHero GraphQL error: ${error.message}`,
      statusCode
    );
  }

  if (!result.data) {
    throw new ShipHeroAPIError("No data returned from ShipHero API", 500);
  }

  return result.data;
}

/**
 * Perform initial login with username/password
 */
async function performLogin(
  username: string,
  password: string
): Promise<ShipHeroTokenResponse> {
  console.log("Performing initial login for user:", username);
  
  const data = await callShipHeroAPI<LoginMutationData>(
    LOGIN_MUTATION,
    {
      email: username,
      password: password,
    }
  );

  return data.access_token.request_new_access_token;
}

/**
 * Refresh access token using REST endpoint (NOT GraphQL)
 * Endpoint: POST https://public-api.shiphero.com/auth/refresh
 */
async function performTokenRefresh(
  refreshToken: string
): Promise<ShipHeroTokenResponse> {
  console.log("Refreshing access token via REST API...");
  console.log("Refresh token length:", refreshToken.length);
  console.log("Refresh token first/last 5 chars:", refreshToken.substring(0, 5) + "..." + refreshToken.substring(refreshToken.length - 5));
  
  const response = await fetch(SHIPHERO_AUTH_REFRESH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      refresh_token: refreshToken,
    }),
  });

  const responseText = await response.text();
  console.log("ShipHero refresh response status:", response.status);
  console.log("ShipHero refresh response body:", responseText.substring(0, 500));

  if (!response.ok) {
    throw new AuthenticationRequiredError(
      `Token refresh failed: ${response.status} - ${responseText.substring(0, 200)}`
    );
  }

  let result: {
    access_token: string;
    expires_in: number;
    scope: string;
    token_type: string;
  };

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new ShipHeroAPIError(`Failed to parse refresh response: ${responseText.substring(0, 200)}`, 500);
  }

  console.log("Token refresh successful! New token expires in:", result.expires_in, "seconds");

  return {
    access_token: result.access_token,
    refresh_token: refreshToken, // Keep the same refresh token
    expires_in: result.expires_in,
  };
}

/**
 * Validate developer token by making a test API call
 */
async function validateDeveloperToken(token: string): Promise<AccountQueryData> {
  console.log("Validating developer token...");
  
  const data = await callShipHeroAPI<AccountQueryData>(
    ACCOUNT_QUERY,
    {},
    token
  );

  return data;
}

/**
 * Calculate expiration timestamp from expires_in seconds
 */
function calculateExpiresAt(expiresIn: number): string {
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  return expiresAt.toISOString();
}

// =============================================================================
// MAIN HANDLER
// =============================================================================

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Only accept POST requests
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed. Use POST." }),
        {
          status: 405,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    let body: AuthRequest;
    try {
      const rawBody = await req.text();
      console.log("Received request body:", rawBody);
      body = JSON.parse(rawBody);
      console.log("Parsed body:", JSON.stringify(body));
    } catch (e) {
      console.error("JSON parse error:", e);
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body", details: String(e) }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Initialize Supabase client with Service Role key
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("Missing Supabase environment variables");
      return new Response(
        JSON.stringify({ error: "Server configuration error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    let accessToken: string;
    let refreshToken: string | null = null;
    let expiresAt: string;
    let authType: "oauth" | "developer" = "oauth";
    let accountInfo: AccountQueryData | null = null;

    // =========================================================================
    // Handle GET CREDENTIALS flow (retrieve stored credentials)
    // =========================================================================
    if (isGetCredentialsRequest(body)) {
      console.log("Processing get credentials request...");
      
      // Get stored credentials from database
      const { data: credentials, error: fetchError } = await supabase
        .from("api_credentials")
        .select("access_token, refresh_token, expires_at, updated_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (fetchError || !credentials) {
        console.log("No stored credentials found");
        return new Response(
          JSON.stringify({
            success: false,
            has_credentials: false,
            message: "No stored credentials found",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Check if credentials are expired
      const expiresAt = new Date(credentials.expires_at);
      const isExpired = expiresAt < new Date();
      const hasRefreshToken = credentials.refresh_token && credentials.refresh_token.length > 0;

      console.log("Found stored credentials, expires_at:", credentials.expires_at, "isExpired:", isExpired);

      return new Response(
        JSON.stringify({
          success: true,
          has_credentials: true,
          access_token: credentials.access_token,
          refresh_token: hasRefreshToken ? credentials.refresh_token : null,
          expires_at: credentials.expires_at,
          is_expired: isExpired,
          auth_type: hasRefreshToken ? "oauth" : "developer",
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // =========================================================================
    // Handle DEVELOPER TOKEN flow
    // =========================================================================
    if (isDeveloperTokenRequest(body)) {
      console.log("Processing developer token request...");
      
      if (!body.developer_token || body.developer_token.trim() === "") {
        return new Response(
          JSON.stringify({ error: "Developer token is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Validate the token by making a test API call
      try {
        accountInfo = await validateDeveloperToken(body.developer_token);
        console.log("Developer token validated. Account:", accountInfo.account.data?.email);
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) {
          return new Response(
            JSON.stringify({
              error: "invalid_token",
              message: "Developer token is invalid or expired. Please check your token and try again.",
            }),
            {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        throw error;
      }

      accessToken = body.developer_token;
      refreshToken = null; // Developer tokens don't have refresh tokens
      // Developer tokens typically don't expire, but we set a long expiry for tracking
      expiresAt = calculateExpiresAt(DEVELOPER_TOKEN_EXPIRY_DAYS * 24 * 60 * 60);
      authType = "developer";

    // =========================================================================
    // Handle DIRECT REFRESH TOKEN flow (user provides refresh token directly)
    // =========================================================================
    } else if (isRefreshWithTokenRequest(body)) {
      console.log("Processing direct refresh token request...");
      
      if (!body.refresh_token_direct || body.refresh_token_direct.trim() === "") {
        return new Response(
          JSON.stringify({ error: "Refresh token is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Perform OAuth token refresh with the provided refresh token
      try {
        const tokenResponse = await performTokenRefresh(body.refresh_token_direct);
        accessToken = tokenResponse.access_token;
        refreshToken = tokenResponse.refresh_token;
        expiresAt = calculateExpiresAt(tokenResponse.expires_in);
        authType = "oauth";
        console.log("Token refreshed successfully. New expiry:", expiresAt);
      } catch (error) {
        if (error instanceof AuthenticationRequiredError) {
          return new Response(
            JSON.stringify({
              error: "invalid_refresh_token",
              message: "Refresh token is invalid or expired. Please generate a new one from ShipHero.",
            }),
            {
              status: 401,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        }
        throw error;
      }

    // =========================================================================
    // Handle REFRESH TOKEN flow (from stored credentials)
    // =========================================================================
    } else if (isRefreshRequest(body)) {
      console.log("Processing token refresh request...");
      
      // Get stored credentials from database
      const { data: credentials, error: fetchError } = await supabase
        .from("api_credentials")
        .select("access_token, refresh_token, expires_at")
        .order("updated_at", { ascending: false })
        .limit(1)
        .single();

      if (fetchError || !credentials) {
        console.error("Failed to fetch stored credentials:", fetchError);
        throw new AuthenticationRequiredError(
          "No stored credentials found. Initial authentication required."
        );
      }

      // Check if we have a refresh token (OAuth flow)
      if (credentials.refresh_token) {
        // Perform OAuth token refresh
        const tokenResponse = await performTokenRefresh(credentials.refresh_token);
        accessToken = tokenResponse.access_token;
        refreshToken = tokenResponse.refresh_token;
        expiresAt = calculateExpiresAt(tokenResponse.expires_in);
      } else {
        // Developer token - just validate it's still working
        try {
          await validateDeveloperToken(credentials.access_token);
          // Token still valid, just return success
          return new Response(
            JSON.stringify({
              success: true,
              message: "Developer token is still valid",
              auth_type: "developer",
              expires_at: credentials.expires_at,
            }),
            {
              status: 200,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            }
          );
        } catch {
          throw new AuthenticationRequiredError(
            "Developer token is no longer valid. Please provide a new token."
          );
        }
      }

    // =========================================================================
    // Handle USERNAME/PASSWORD LOGIN flow
    // =========================================================================
    } else if (isLoginRequest(body)) {
      console.log("Processing initial login request...");
      
      if (!body.username || !body.password) {
        return new Response(
          JSON.stringify({ 
            error: "Missing required fields: username and password" 
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      // Perform login
      const tokenResponse = await performLogin(body.username, body.password);
      accessToken = tokenResponse.access_token;
      refreshToken = tokenResponse.refresh_token;
      expiresAt = calculateExpiresAt(tokenResponse.expires_in);
      
    // =========================================================================
    // Invalid request
    // =========================================================================
    } else {
      return new Response(
        JSON.stringify({ 
          error: "Invalid request. Provide one of: {username, password}, {developer_token}, or {refresh: true}" 
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // =========================================================================
    // Store credentials in database
    // =========================================================================
    console.log("Storing credentials in database...");
    
    // First, get existing record ID (if any)
    const { data: existingCredentials } = await supabase
      .from("api_credentials")
      .select("id")
      .limit(1)
      .single();

    let upsertError;

    const credentialData = {
      access_token: accessToken,
      refresh_token: refreshToken || "", // Use empty string if null (for developer tokens)
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    };

    if (existingCredentials?.id) {
      // Update existing record
      const { error } = await supabase
        .from("api_credentials")
        .update(credentialData)
        .eq("id", existingCredentials.id);
      
      upsertError = error;
    } else {
      // Insert new record
      const { error } = await supabase
        .from("api_credentials")
        .insert(credentialData);
      
      upsertError = error;
    }

    if (upsertError) {
      console.error("Failed to store credentials:", upsertError);
      return new Response(
        JSON.stringify({ 
          error: "Failed to store credentials",
          details: upsertError.message 
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log("Authentication successful. Credentials stored.");

    // Return success response
    const response: Record<string, unknown> = {
      success: true,
      message: authType === "developer" 
        ? "Developer token validated and saved" 
        : "Authentication successful",
      auth_type: authType,
      expires_at: expiresAt,
    };

    // Include account info for developer tokens
    if (accountInfo?.account?.data) {
      response.account = {
        email: accountInfo.account.data.email,
        id: accountInfo.account.data.id,
      };
    }

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Authentication error:", error);

    // Handle specific authentication errors
    if (error instanceof AuthenticationRequiredError) {
      return new Response(
        JSON.stringify({
          error: "authentication_required",
          message: error.message,
          action: "Please provide valid credentials.",
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Handle ShipHero API errors
    if (error instanceof ShipHeroAPIError) {
      return new Response(
        JSON.stringify({
          error: "shiphero_api_error",
          message: error.message,
          status_code: error.statusCode,
        }),
        {
          status: error.statusCode >= 400 && error.statusCode < 600 
            ? error.statusCode 
            : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Handle unexpected errors
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
