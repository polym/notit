import { useState, useEffect, useRef } from 'react';
import type { IHighlight } from '../../shared/types';
import { getSupabaseClient } from '../utils/supabase';

export const useHighlights = () => {
  const [highlights, setHighlights] = useState<IHighlight[]>([]);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const isSyncingFromSupabase = useRef(false);

  // Sync with Supabase on load
  useEffect(() => {
    const syncWithSupabase = async () => {
      const supabase = await getSupabaseClient();
      if (!supabase) return;

      const { data, error } = await supabase.from('highlights').select('*');
      if (!error && data) {
        isSyncingFromSupabase.current = true;
        // Merge or replace? Let's replace local with server for now to ensure consistency
        // But we need to be careful not to lose offline work.
        // For MVP: Server wins.
        await chrome.storage.local.set({ highlights: data });
        setHighlights(data as IHighlight[]);
        isSyncingFromSupabase.current = false;
      }
    };
    syncWithSupabase();
  }, []);

  useEffect(() => {
    // Initial load
    chrome.storage.local.get('highlights').then((result) => {
      if (result.highlights) {
        setHighlights(result.highlights as IHighlight[]);
      }
    });

    // Listen for changes
    const handleStorageChange = async (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === 'local' && changes.highlights) {
        const newHighlights = changes.highlights.newValue as IHighlight[];
        setHighlights(newHighlights);

        // Sync to Supabase if change didn't come from Supabase sync
        if (!isSyncingFromSupabase.current) {
          const supabase = await getSupabaseClient();
          if (supabase) {
            // Find added/updated highlights
            // This is a naive sync: upsert all. 
            // Optimization: find diff.
            // For MVP, let's just upsert the whole list? No, that's too heavy if list is long.
            // Let's try to find the diff.
            const oldHighlights = (changes.highlights.oldValue || []) as IHighlight[];
            
            // Added or Updated
            const toUpsert = newHighlights.filter(nh => {
                const oh = oldHighlights.find(h => h.id === nh.id);
                return !oh || JSON.stringify(oh) !== JSON.stringify(nh);
            });

            if (toUpsert.length > 0) {
                await supabase.from('highlights').upsert(toUpsert);
            }
            
            // Deleted
            // We handle deletion in removeHighlight explicitly, but if content script deletes?
            // Content script usually only adds.
            // If we want to support deletion sync from storage change, we need to find missing IDs.
             const toDelete = oldHighlights.filter(oh => !newHighlights.find(nh => nh.id === oh.id));
             if (toDelete.length > 0) {
                 await supabase.from('highlights').delete().in('id', toDelete.map(h => h.id));
             }
          }
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  useEffect(() => {
    const getCurrentTab = async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.url) {
        setCurrentUrl(tab.url);
      }
    };
    getCurrentTab();

    const handleTabActivated = () => getCurrentTab();
    const handleTabUpdated = (
      _tabId: number,
      changeInfo: any,
      tab: chrome.tabs.Tab
    ) => {
      if (tab.active && changeInfo.url) {
        setCurrentUrl(changeInfo.url);
      }
    };

    chrome.tabs.onActivated.addListener(handleTabActivated);
    chrome.tabs.onUpdated.addListener(handleTabUpdated);

    return () => {
      chrome.tabs.onActivated.removeListener(handleTabActivated);
      chrome.tabs.onUpdated.removeListener(handleTabUpdated);
    };
  }, []);

  const jumpToHighlight = async (id: string) => {
    const highlight = highlights.find(h => h.id === id);
    if (!highlight) return;

    try {
      // 查询匹配 URL 的标签页
      const tabs = await chrome.tabs.query({ url: highlight.url });
      let targetTab = tabs[0];
      let isNewTab = false;

      if (!targetTab) {
        // 如果没找到，创建新标签页
        isNewTab = true;
        targetTab = await chrome.tabs.create({ url: highlight.url });
        // 等待页面加载完成
        await new Promise<void>((resolve) => {
          const listener = (tabId: number, changeInfo: any) => {
            if (tabId === targetTab!.id && changeInfo.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
        });
        
        // 额外等待确保content script已加载并完成高亮渲染
        await new Promise(resolve => setTimeout(resolve, 800));
      } else {
        // 如果找到了，激活该标签页
        if (targetTab.id) {
          await chrome.tabs.update(targetTab.id, { active: true });
          // 切换到该标签页所在的窗口
          if (targetTab.windowId) {
            await chrome.windows.update(targetTab.windowId, { focused: true });
          }
        }
      }

      // 发送消息到目标标签页
      if (targetTab.id) {
        // 对于新标签页，使用重试机制确保消息能够送达
        if (isNewTab) {
          let retries = 3;
          while (retries > 0) {
            try {
              await chrome.tabs.sendMessage(targetTab.id, { action: 'SCROLL_TO_HIGHLIGHT', id });
              break; // 成功发送，退出循环
            } catch (error) {
              retries--;
              if (retries > 0) {
                console.log(`[NoteIt] Retry sending message, ${retries} attempts left`);
                await new Promise(resolve => setTimeout(resolve, 300));
              } else {
                console.error('[NoteIt] Failed to send message after retries:', error);
              }
            }
          }
        } else {
          chrome.tabs.sendMessage(targetTab.id, { action: 'SCROLL_TO_HIGHLIGHT', id });
        }
      }
    } catch (error) {
      console.error('[NoteIt] Failed to jump to highlight:', error);
    }
  };

  const removeHighlight = async (id: string) => {
    const newHighlights = highlights.filter((h) => h.id !== id);
    await chrome.storage.local.set({ highlights: newHighlights });

    // Sync delete to Supabase
    const supabase = await getSupabaseClient();
    if (supabase) {
        await supabase.from('highlights').delete().eq('id', id);
    }

    // Also send message to content script to remove visual highlight
    // We need to find the tab that has this highlight.
    // For MVP, we assume the user is on the page or we send to active tab.
    // Ideally, we check the URL of the highlight.
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { action: 'DELETE_HIGHLIGHT', id });
    }
  };

  return { highlights, removeHighlight, jumpToHighlight, currentUrl };
};
