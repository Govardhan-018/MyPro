/**
 * My Library — the web app's library view, as a phone screen.
 *
 * Same words and same controls as `LibraryView` in `frontend/src/App.tsx`:
 * the search field, the category pills (All · Books · Podcasts · Articles ·
 * Notes), the status filters, and the "Pick up where you left off" shelf of
 * cover cards.
 *
 * It reads every content type, not just books, and uses the API's own status
 * vocabulary — `in_progress | completed | want | favorite` — which is what
 * the web's `libraryMap` maps to the labels shown here. Only a book with
 * synced text opens in the reader; the rest say what they need instead of
 * failing silently.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { Text, TextInput } from '../components/Typography';
import { Ionicons } from '@expo/vector-icons';
import type { LibraryItemRow, LibraryType } from '@mypro/shared';
import { client } from '../lib/client';
import {
  Card, CardHeading, CategoryChip, ChipRow, DataBanner, EmptyState, FadeIn, FilterChip,
  Loading, PageHeading, PrimaryButton, Progress, Sheet, Thumbnail, useToast, type IconName,
} from '../components/ui';
import { colors, radius, shared, space, type, useTheme } from '../theme';

export interface BookSummary {
  id: string;
  title: string;
  creator: string;
  currentPage: number;
  totalPages: number;
  hasText: boolean;
}

/* ---- the API's vocabulary, and the labels the web shows for it ---------- */

type ApiStatus = 'in_progress' | 'completed' | 'want' | 'favorite';

const CATEGORIES = ['All', 'Books', 'Podcasts', 'Articles', 'Notes'] as const;
type Category = (typeof CATEGORIES)[number];

const FILTERS = ['All', 'In Progress', 'Completed', 'Want to Read', 'Favorites'] as const;
type Filter = (typeof FILTERS)[number];

const FILTER_TO_STATUS: Record<Exclude<Filter, 'All'>, ApiStatus> = {
  'In Progress': 'in_progress',
  Completed: 'completed',
  'Want to Read': 'want',
  Favorites: 'favorite',
};

const TYPE_TO_CATEGORY: Record<LibraryType, Exclude<Category, 'All'>> = {
  book: 'Books',
  podcast: 'Podcasts',
  article: 'Articles',
  note: 'Notes',
};

const CATEGORY_TO_TYPE: Record<Exclude<Category, 'All'>, LibraryType> = {
  Books: 'book',
  Podcasts: 'podcast',
  Articles: 'article',
  Notes: 'note',
};

const TYPE_ICON: Record<LibraryType, IconName> = {
  book: 'book',
  podcast: 'mic',
  article: 'document-text',
  note: 'create',
};

/** The web's `humanAccessed`. */
function humanAccessed(iso: string | null): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const then = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.floor((startOfToday - then) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

interface Item {
  id: string;
  title: string;
  creator: string;
  libraryType: LibraryType;
  category: Exclude<Category, 'All'>;
  status: ApiStatus;
  progress: number;
  accessed: string;
  /** Books only. */
  currentPage: number;
  totalPages: number;
  hasText: boolean;
}

/** Supabase returns a to-one embed as either an object or a 1-element array. */
function firstDetail(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (Array.isArray(raw)) return (raw[0] as Record<string, unknown>) ?? {};
  return raw as Record<string, unknown>;
}

function toItem(row: LibraryItemRow): Item {
  const details = firstDetail(row.book_details);
  const number = (value: unknown) => (typeof value === 'number' ? value : 0);
  const totalPages = number(details.total_pages);
  const currentPage = number(details.current_page) || 1;
  const libraryType = (row.type ?? 'book') as LibraryType;
  return {
    id: row.id,
    title: row.title,
    creator: row.creator ?? '',
    libraryType,
    category: TYPE_TO_CATEGORY[libraryType] ?? 'Books',
    status: ((row.status as ApiStatus) ?? 'want') satisfies ApiStatus,
    progress:
      typeof row.progress === 'number' && row.progress > 0
        ? row.progress
        : totalPages
          ? Math.round((currentPage / totalPages) * 100)
          : 0,
    accessed: humanAccessed(row.accessed_at),
    currentPage,
    totalPages,
    // Set by backend-render once a device has uploaded the extracted text.
    hasText: typeof details.pdf_json_path === 'string' && !!details.pdf_json_path,
  };
}

/* ------------------------------------------------------------------------ */

export function LibraryScreen({ onOpen }: { onOpen: (book: BookSummary) => void }) {
  const toast = useToast();
  const { accent } = useTheme();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category>('All');
  const [filter, setFilter] = useState<Filter>('All');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Every type, as the web does — the category pills filter on the client.
      const rows = await client.api.library.list();
      setItems(rows.map(toItem));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load your library.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== 'All' && item.category !== category) return false;
      if (filter !== 'All' && item.status !== FILTER_TO_STATUS[filter]) return false;
      if (!needle) return true;
      return (
        item.title.toLowerCase().includes(needle) ||
        item.creator.toLowerCase().includes(needle)
      );
    });
  }, [items, query, category, filter]);

  const inProgress = useMemo(
    () => visible.filter((item) => item.status === 'in_progress' || item.progress > 0),
    [visible],
  );

  const open = (item: Item) => {
    if (item.libraryType !== 'book') {
      toast.show(`${item.category.replace(/s$/, '')} playback lives in the web app for now.`);
      return;
    }
    onOpen({
      id: item.id,
      title: item.title,
      creator: item.creator,
      currentPage: item.currentPage,
      totalPages: item.totalPages,
      hasText: item.hasText,
    });
  };

  if (loading) return <Loading />;

  return (
    <View style={shared.screen}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingTop: 22,
          paddingBottom: 28,
        }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor={colors.textMuted}
          />
        }
      >
        <PageHeading
          eyebrow="My library"
          title="Your ideas, all in one place."
          lede="Books, listening, articles, and the notes you want to keep."
          actionIcon="add"
          actionLabel="Add to library"
          onAction={() => setAdding(true)}
        />

        {!!error && <DataBanner message={error} error />}

        {/* `.library-toolbar` */}
        <FadeIn index={1} style={{ marginBottom: space.md }}>
          {/* `.library-search` */}
          <View
            style={{
              height: 50,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              paddingHorizontal: space.md,
              borderWidth: 1,
              borderColor: colors.borderStrong,
              borderRadius: radius.lg,
              backgroundColor: colors.surface,
            }}
          >
            <Ionicons name="search" size={17} color={colors.textSoft} />
            <TextInput
              style={{ flex: 1, color: colors.text, fontSize: 16, paddingVertical: 0 }}
              placeholder="Search your library"
              placeholderTextColor="rgba(255,255,255,0.44)"
              value={query}
              onChangeText={setQuery}
              returnKeyType="search"
              accessibilityLabel="Search your library"
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery('')}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={17} color={colors.textSoft} />
              </Pressable>
            )}
          </View>

          {/* `.library-categories` */}
          <View style={{ marginTop: 14 }}>
            <ChipRow>
              {CATEGORIES.map((item) => (
                <CategoryChip
                  key={item}
                  label={item}
                  active={category === item}
                  onPress={() => setCategory(item)}
                />
              ))}
            </ChipRow>
          </View>

          {/* `.library-filters` */}
          <View style={{ marginTop: 10 }}>
            <ChipRow>
              {FILTERS.map((item) => (
                <FilterChip
                  key={item}
                  label={item}
                  active={filter === item}
                  onPress={() => setFilter(item)}
                />
              ))}
            </ChipRow>
          </View>
        </FadeIn>

        {/* `.continue-learning-card` — the horizontal shelf of cover cards. */}
        <FadeIn index={2}>
          <Card style={{ paddingRight: 0 }}>
            <View style={{ paddingRight: 18 }}>
              <CardHeading
                kicker="Continue"
                title="Pick up where you left off"
                trailing={
                  <Text style={{ color: colors.textSoft, fontSize: 11 }}>
                    {visible.length} {visible.length === 1 ? 'item' : 'items'}
                  </Text>
                }
              />
            </View>

            {(inProgress.length ? inProgress : visible).length === 0 ? (
              <View style={{ paddingRight: 18 }}>
                <EmptyState
                  icon="book-outline"
                  title={items.length ? 'No matches' : 'Nothing here yet'}
                  body={
                    items.length
                      ? 'Nothing in your library fits that search and filter.'
                      : 'Add a book, podcast, article or note and it will appear here.'
                  }
                />
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12, paddingRight: 18, paddingVertical: 2 }}
              >
                {(inProgress.length ? inProgress : visible).map((item) => (
                  <ShelfCard key={item.id} item={item} accent={accent} onOpen={() => open(item)} />
                ))}
              </ScrollView>
            )}
          </Card>
        </FadeIn>

        {/* Everything matching the filters, as a readable vertical list.
            The browser shows one horizontal shelf; a phone needs a list it
            can scan, so the same card language is reused in rows. */}
        {visible.length > 0 && (
          <FadeIn index={3} style={{ marginTop: 12 }}>
            <Card>
              <CardHeading kicker="All items" title="Everything you have saved" />
              <View style={{ gap: 2 }}>
                {visible.map((item, index) => (
                  <Pressable
                    key={item.id}
                    onPress={() => open(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${item.title}`}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 14,
                      borderTopWidth: index === 0 ? 0 : 1,
                      borderTopColor: colors.dividerFaint,
                      backgroundColor: pressed ? 'rgba(255,255,255,0.03)' : 'transparent',
                    })}
                  >
                    <Thumbnail
                      title={item.title}
                      icon={TYPE_ICON[item.libraryType]}
                      width={44}
                      height={56}
                      rounded={9}
                    />
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={type.label}>{item.category.replace(/s$/, '')}</Text>
                      <Text style={type.h3} numberOfLines={2}>
                        {item.title}
                      </Text>
                      {!!item.creator && (
                        <Text style={type.meta} numberOfLines={1}>
                          {item.creator}
                        </Text>
                      )}
                      {item.progress > 0 && item.progress < 100 && (
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <Progress value={item.progress / 100} style={{ flex: 1 }} />
                          <Text style={{ color: colors.textSoft, fontSize: 11.5 }}>
                            {item.progress}%
                          </Text>
                        </View>
                      )}
                    </View>
                    <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
                  </Pressable>
                ))}
              </View>
            </Card>
          </FadeIn>
        )}
      </ScrollView>

      <AddSheet
        visible={adding}
        onClose={() => setAdding(false)}
        onAdded={() => {
          setAdding(false);
          void load();
        }}
      />
    </View>
  );
}

/**
 * `.learning-row` — a 214px card: cover, type label, title, creator,
 * progress, then "last opened" and a Continue button.
 */
function ShelfCard({
  item,
  accent,
  onOpen,
}: {
  item: Item;
  accent: string;
  onOpen: () => void;
}) {
  const { colorMode } = useTheme();
  return (
    <View
      style={{
        width: 214,
        padding: 10,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.xl,
        backgroundColor: colors.surface,
        gap: 12,
      }}
    >
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.title}`}
        style={{
          width: '100%',
          height: 132,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          backgroundColor: 'rgba(255,255,255,0.07)',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <Text style={{ color: colors.text, fontSize: 34, fontWeight: '600' }}>
          {(item.title.trim()[0] ?? '?').toUpperCase()}
        </Text>
        <Ionicons name={TYPE_ICON[item.libraryType]} size={16} color="rgba(255,255,255,0.5)" />
      </Pressable>

      <View style={{ flex: 1, paddingHorizontal: 4, paddingBottom: 2, gap: 4 }}>
        <Text style={type.label}>{item.category.replace(/s$/, '')}</Text>
        <Text style={type.h3} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[type.meta, { marginBottom: 8 }]} numberOfLines={1}>
          {item.creator || 'In your library'}
        </Text>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 'auto' }}>
          <Progress value={item.progress / 100} style={{ flex: 1 }} />
          <Text style={{ color: colors.text, fontSize: 11.5, fontWeight: '600' }}>
            {item.progress}%
          </Text>
        </View>

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginTop: 10,
          }}
        >
          <Text style={{ flex: 1, color: colors.textSoft, fontSize: 11.5 }} numberOfLines={1}>
            Last opened {item.accessed}
          </Text>
          <Pressable
            onPress={onOpen}
            accessibilityRole="button"
            accessibilityLabel={`Continue ${item.title}`}
            style={{
              height: 34,
              paddingHorizontal: 12,
              borderRadius: radius.pill,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 5,
              backgroundColor: colorMode ? 'rgba(182,154,245,0.16)' : colors.text,
            }}
          >
            <Ionicons name="play" size={11} color={colorMode ? accent : '#000000'} />
            <Text
              style={{
                color: colorMode ? accent : '#000000',
                fontSize: 12.5,
                fontWeight: '600',
              }}
            >
              Continue
            </Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/**
 * Add to library — the four content types the API knows, each with the
 * fields its own detail table accepts. The PDF itself is not added here: the
 * file stays on the device that imports it, and this app has no PDF to parse,
 * so a book added from the phone is the record, and its text arrives once the
 * holding device opens it.
 */
function AddSheet({
  visible,
  onClose,
  onAdded,
}: {
  visible: boolean;
  onClose: () => void;
  onAdded: () => void;
}) {
  const toast = useToast();
  const [kind, setKind] = useState<Exclude<Category, 'All'>>('Books');
  const [title, setTitle] = useState('');
  const [creator, setCreator] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setKind('Books');
    setTitle('');
    setCreator('');
    setLink('');
  };

  const creatorLabel =
    kind === 'Books'
      ? 'Author'
      : kind === 'Podcasts'
        ? 'Creator or channel'
        : kind === 'Articles'
          ? 'Source or author'
          : 'Author (optional)';

  const save = async () => {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      toast.show('Give it a title first.');
      return;
    }
    const url = link.trim();
    if ((kind === 'Podcasts' || kind === 'Articles') && url && !/^https?:\/\//i.test(url)) {
      toast.show('The link needs to start with http:// or https://');
      return;
    }

    const libraryType = CATEGORY_TO_TYPE[kind];
    const details: Record<string, unknown> = {};
    if (kind === 'Podcasts' && url) details.youtube_url = url;
    if (kind === 'Podcasts' && creator.trim()) details.channel = creator.trim();
    if (kind === 'Articles' && url) details.source_url = url;
    if (kind === 'Articles' && creator.trim()) details.author = creator.trim();

    setBusy(true);
    try {
      await client.api.library.create({
        type: libraryType,
        title: trimmedTitle,
        ...(creator.trim() ? { creator: creator.trim() } : {}),
        status: 'want',
        ...(Object.keys(details).length ? { details } : {}),
      });
      toast.show(`Added “${trimmedTitle}” to your library`);
      reset();
      onAdded();
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : 'Could not add that.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onClose} kicker="New item" title="Add to library">
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
        <View style={{ gap: 14 }}>
          <View>
            <Text style={[type.label, { marginBottom: 8 }]}>Type</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {(['Books', 'Podcasts', 'Articles', 'Notes'] as const).map((option) => (
                <CategoryChip
                  key={option}
                  label={option}
                  active={kind === option}
                  onPress={() => setKind(option)}
                />
              ))}
            </View>
          </View>

          <View style={{ gap: 7 }}>
            <Text style={type.label}>Title</Text>
            <TextInput
              style={shared.input}
              placeholder={kind === 'Podcasts' ? 'Episode or show title' : 'Title'}
              placeholderTextColor="rgba(255,255,255,0.44)"
              value={title}
              onChangeText={setTitle}
              accessibilityLabel="Title"
            />
          </View>

          <View style={{ gap: 7 }}>
            <Text style={type.label}>{creatorLabel}</Text>
            <TextInput
              style={shared.input}
              placeholder={creatorLabel}
              placeholderTextColor="rgba(255,255,255,0.44)"
              value={creator}
              onChangeText={setCreator}
              accessibilityLabel={creatorLabel}
            />
          </View>

          {(kind === 'Podcasts' || kind === 'Articles') && (
            <View style={{ gap: 7 }}>
              <Text style={type.label}>{kind === 'Podcasts' ? 'Source link' : 'URL'}</Text>
              <TextInput
                style={shared.input}
                placeholder="https://"
                placeholderTextColor="rgba(255,255,255,0.44)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                value={link}
                onChangeText={setLink}
                accessibilityLabel={kind === 'Podcasts' ? 'Source link' : 'URL'}
              />
            </View>
          )}

          {kind === 'Books' && (
            <Text style={type.meta}>
              The PDF itself stays on the device you import it from — add the file in the web app
              and its text syncs here.
            </Text>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <PrimaryButton
              label="Add to library"
              onPress={() => void save()}
              busy={busy}
              disabled={!title.trim()}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </ScrollView>
    </Sheet>
  );
}
