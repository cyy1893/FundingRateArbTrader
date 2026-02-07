export type LoginResponse = {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
};

export type LoginError = {
  detail?: string;
  error?: string;
};
