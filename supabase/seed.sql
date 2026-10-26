-- Local / CI only: two confirmed email-password test users.
-- Passwords are local test values and never used against the live project.
--   User A: user-a@noteit.test / test-password-a
--   User B: user-b@noteit.test / test-password-b
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
) values
  (
    '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-00000000000a',
    'authenticated', 'authenticated', 'user-a@noteit.test',
    extensions.crypt('test-password-a', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000', '00000000-0000-4000-a000-00000000000b',
    'authenticated', 'authenticated', 'user-b@noteit.test',
    extensions.crypt('test-password-b', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''
  );

insert into auth.identities (
  id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at
) values
  (
    gen_random_uuid(), '00000000-0000-4000-a000-00000000000a', '00000000-0000-4000-a000-00000000000a',
    'email', '{"sub":"00000000-0000-4000-a000-00000000000a","email":"user-a@noteit.test","email_verified":true}',
    now(), now(), now()
  ),
  (
    gen_random_uuid(), '00000000-0000-4000-a000-00000000000b', '00000000-0000-4000-a000-00000000000b',
    'email', '{"sub":"00000000-0000-4000-a000-00000000000b","email":"user-b@noteit.test","email_verified":true}',
    now(), now(), now()
  );
