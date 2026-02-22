import { useState, useEffect } from 'react';

const ITEMS_PER_PAGE_OPTIONS = [10, 20, 50, 100] as const;
export { ITEMS_PER_PAGE_OPTIONS };

export function usePagination<T>(items: T[], storageKey: string) {
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      const parsed = stored ? parseInt(stored, 10) : 20;
      return ITEMS_PER_PAGE_OPTIONS.includes(parsed as typeof ITEMS_PER_PAGE_OPTIONS[number])
        ? parsed
        : 20;
    } catch {
      return 20;
    }
  });

  // Volta para página 1 sempre que a lista filtrada mudar
  useEffect(() => {
    setCurrentPage(1);
  }, [items]);

  const totalPages = Math.max(1, Math.ceil(items.length / itemsPerPage));
  const safeCurrentPage = Math.min(currentPage, totalPages);
  const startIdx = (safeCurrentPage - 1) * itemsPerPage;
  const paginatedItems = items.slice(startIdx, startIdx + itemsPerPage);

  const handleItemsPerPageChange = (n: number) => {
    setItemsPerPage(n);
    try {
      localStorage.setItem(storageKey, String(n));
    } catch {
      // localStorage indisponível (ex: modo privado restrito)
    }
    setCurrentPage(1);
  };

  return {
    currentPage: safeCurrentPage,
    totalPages,
    itemsPerPage,
    paginatedItems,
    startIdx,
    setCurrentPage,
    handleItemsPerPageChange,
  };
}
