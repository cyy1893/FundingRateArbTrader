export type AdminUserSummary = {
  id: string;
  username: string;
  is_admin: boolean;
  is_active: boolean;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
  updated_at: string;
  has_lighter_credentials: boolean;
  has_grvt_credentials: boolean;
  lighter_account_index: number | null;
  lighter_api_key_index: number | null;
  lighter_private_key_configured: boolean;
  lighter_private_key: string | null;
  grvt_trading_account_id: string | null;
  grvt_api_key_configured: boolean;
  grvt_private_key_configured: boolean;
  grvt_api_key: string | null;
  grvt_private_key: string | null;
};

export type AdminUserListResponse = {
  users: AdminUserSummary[];
};

export type AdminCreateUserRequest = {
  username: string;
  password: string;
  is_admin: boolean;
  is_active: boolean;
  lighter_account_index: number;
  lighter_api_key_index: number;
  lighter_private_key: string;
  grvt_api_key: string;
  grvt_private_key: string;
  grvt_trading_account_id: string;
};

export type AdminCreateUserResponse = {
  id: string;
  username: string;
  is_admin: boolean;
  is_active: boolean;
  created_at: string;
};

export type AdminResetPasswordResponse = {
  id: string;
  username: string;
  updated_at: string;
  temporary_password: string;
};
