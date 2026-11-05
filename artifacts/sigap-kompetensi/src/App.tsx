import { useEffect, useRef, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, useAuth, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { dark } from '@clerk/themes';
import { idID } from '@clerk/localizations';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Layout } from '@/components/layout';
import { Skeleton } from '@/components/bits';
import Dashboard from '@/pages/dashboard';
import Catalog from '@/pages/catalog';
import Practice from '@/pages/practice';
import Agents from '@/pages/agents';
import Paspor from '@/pages/paspor';
import Ujk from '@/pages/ujk';
import Review from '@/pages/review';
import Notifications from '@/pages/notifications';
import { SignInPage, SignUpPage } from '@/pages/auth';
import NotFound from '@/pages/not-found';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } } });

const clerkAppearance = {
  theme: dark,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: '#4da3ff',
    colorForeground: '#f1f5fb',
    colorMutedForeground: '#b4c3d8',
    colorDanger: '#f87171',
    colorBackground: '#0f1420',
    colorInput: '#0a0e17',
    colorInputForeground: '#f1f5fb',
    colorNeutral: '#8aa0bd',
    fontFamily: "'Bricolage Grotesque', sans-serif",
    borderRadius: '0.25rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[#0f1420] border-2 border-[#4da3ff] w-[440px] max-w-full overflow-hidden',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: 'text-[#f1f5fb] font-extrabold',
    headerSubtitle: 'text-[#b4c3d8]',
    socialButtonsBlockButtonText: 'text-[#f1f5fb]',
    formFieldLabel: 'text-[#dbeafe] font-bold',
    footerActionLink: 'text-[#4da3ff] font-bold',
    footerActionText: 'text-[#b4c3d8]',
    dividerText: 'text-[#b4c3d8]',
    identityPreviewEditButton: 'text-[#4da3ff]',
    formFieldSuccessText: 'text-[#7ee0a8]',
    alertText: 'text-[#f1f5fb]',
    logoBox: 'h-12',
    logoImage: 'h-12 w-12',
    formButtonPrimary: 'bg-[#4da3ff] text-[#0a0e17] font-bold hover:bg-[#7bbaff]',
    formFieldInput: 'border-2 border-[#3a4a66]',
  },
};

const localization = {
  ...idID,
  signIn: { ...idID.signIn, start: { ...idID.signIn?.start, title: 'Masuk ke SIGAP', subtitle: 'Buka paspor persiapan UJK Anda' } },
  signUp: { ...idID.signUp, start: { ...idID.signUp?.start, title: 'Buat akun SIGAP', subtitle: 'Mulai catat kemajuan yang jujur' } },
};

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsub = addListener(({ user }) => {
      const id = user?.id ?? null;
      if (prev.current !== undefined && prev.current !== id) qc.clear();
      prev.current = id;
    });
    return unsub;
  }, [addListener, qc]);
  return null;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <Skeleton rows={3} />;
  return isSignedIn ? <Redirect to="/paspor" /> : <Dashboard />;
}

function Private({ children }: { children: (userId: string) => ReactNode }) {
  const { isLoaded, isSignedIn, userId } = useAuth();
  if (!isLoaded) return <Skeleton rows={3} />;
  if (!isSignedIn || !userId) return <Redirect to="/sign-in" />;
  return <div key={userId}>{children(userId)}</div>;
}

function KeyedPractice() {
  const { userId } = useAuth();
  return <Practice key={userId ?? 'anon'} />;
}

function AppShell() {
  const [location] = useLocation();
  return (
    <Layout>
      <ErrorBoundary resetKey={location}>
        <Switch>
          <Route path="/" component={HomeRedirect} />
          <Route path="/paspor">{() => <Private>{() => <Paspor />}</Private>}</Route>
          <Route path="/ujk/:id">{(params) => <Private>{() => <Ujk key={params.id} />}</Private>}</Route>
          <Route path="/review/:id">{() => <Private>{() => <Review />}</Private>}</Route>
          <Route path="/review">{() => <Private>{() => <Review />}</Private>}</Route>
          <Route path="/notifikasi">{() => <Private>{() => <Notifications />}</Private>}</Route>
          <Route path="/katalog" component={Catalog} />
          <Route path="/latihan" component={KeyedPractice} />
          <Route path="/agen" component={Agents} />
          <Route component={NotFound} />
        </Switch>
      </ErrorBoundary>
    </Layout>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={localization}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={AppShell} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
