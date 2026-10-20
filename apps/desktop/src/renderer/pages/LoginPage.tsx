import { zodResolver } from '@hookform/resolvers/zod';
import { Package } from 'lucide-react';
import { type ReactElement, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Button } from '../components/ui/button';
import { FieldError, Label } from '../components/ui/label';
import { Input } from '../components/ui/input';
import { Spinner } from '../components/ui/badge';
import { useI18n } from '../i18n/useI18n';
import { useAuthStore } from '../store/auth';

const loginFormSchema = z.object({
  username: z.string().trim().min(3, 'اسم المستخدم قصير جدًا'),
  password: z.string().min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل'),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

export function LoginPage(): ReactElement {
  const { t } = useI18n();
  const { login, error } = useAuthStore();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setFocus,
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { username: '', password: '' },
  });

  useEffect(() => {
    setFocus('username');
  }, [setFocus]);

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login(values.username, values.password);
    } catch {
      // The store already exposes a friendly Arabic message via `error`.
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-b from-background to-secondary/40 p-6" dir="rtl">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Package className="h-6 w-6 text-primary" />
          </span>
          <h1 className="text-lg font-bold">{t('login.title')}</h1>
          <p className="text-xs text-muted-foreground">{t('login.subtitle')}</p>
        </div>

        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div>
            <Label htmlFor="username">{t('login.username')}</Label>
            <Input
              id="username"
              autoComplete="username"
              className="mt-1.5"
              aria-invalid={Boolean(errors.username)}
              {...register('username')}
            />
            <FieldError message={errors.username?.message} />
          </div>

          <div>
            <Label htmlFor="password">{t('login.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              className="mt-1.5"
              aria-invalid={Boolean(errors.password)}
              {...register('password')}
            />
            <FieldError message={errors.password?.message} />
          </div>

          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? <Spinner className="border-white/40 border-t-white" /> : null}
            {isSubmitting ? t('login.submitting') : t('login.submit')}
          </Button>
        </form>

        <p className="mt-5 rounded-md bg-muted px-3 py-2 text-center text-[11px] text-muted-foreground">
          {t('login.demoHint')}
        </p>
      </div>
    </div>
  );
}
