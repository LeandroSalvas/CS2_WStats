import { useTranslation } from "react-i18next";

interface Props {
  page: number;
  pages: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, pages, onChange }: Props) {
  const { t } = useTranslation();
  if (pages <= 1) return null;
  return (
    <div className="pagination">
      <button disabled={page <= 1} onClick={() => onChange(page - 1)}>{t("pagination.prev")}</button>
      <span>{page} / {pages}</span>
      <button disabled={page >= pages} onClick={() => onChange(page + 1)}>{t("pagination.next")}</button>
    </div>
  );
}
