import { ReactElement } from 'react';
import { useI18n } from '../i18n/useI18n';

export function PhaseTwoPage(): ReactElement {
  const { t } = useI18n();
  return (
    <div className="min-h-[280px] bg-card p-8 text-center">
      <svg
        className="mx-auto mb-4 h-24 w-24 text-muted-foreground"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        focusable="false"
      >
        <path
          d="M12 4m-4 0m4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0zM12 12m-5 0m5 0a5 5 0 1 10 0a5 5 0 1 1 -10 0zM12 20m-6 0m6 0a6 6 0 1 1 12 0a6 6 0 1 1 -12 0zM12 4m-4 0m4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0zM12 12m-5 0m5 0a5 5 0 1 1 10 0a5 5 0 1 1 -10 0zM12 20m-6 0m6 0a6 6 0 1 1 12 0a6 6 0 1 1 -12 0zM12 4m-4 0m4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0zM12 12m-5 0m5 0a5 5 0 1 1 10 0a5 5 0 1 1 -10 0zM12 20m-6 0m6 0a6 6 0 1 1 12 0a6 6 0 1 1 -12 0z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
        <path
          d="M12 4l0 12l6 4l-6 4l0 -12l-6 4l6 4zM12 12l0 8l4 2l-4 2l0 -8l-4 2l4 2zM12 20l0 -8l-4 -2l4 -2l0 8l4 2l-4 2z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        />
      </svg>

      <h2 className="text-xl font-bold text-card">{t('phaseTwo.badge')}</h2>
      <p className="mt-3 text-muted-foreground leading-relaxed">{t('phaseTwo.title')}</p>
      <p className="mt-2 text-[12px] text-muted-foreground">{t('phaseTwo.body')}</p>
    </div>
  );
}