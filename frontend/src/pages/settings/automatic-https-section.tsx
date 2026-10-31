import { useCallback, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "@/components/shared";
import { ApiError } from "@/lib/api-client";
import { activateAutomaticHttps, authorizeAutomaticHttpsBootstrap, checkAutomaticHttpsDns, fetchAutomaticHttpsSettings, saveAutomaticHttpsSettings, testAutomaticHttpsConnection, type AutomaticHttpsInput } from "@/lib/api/settings";

const defaults: AutomaticHttpsInput = { provider: "acmedns", enabled: true, redirectHttpToHttps: false, hostname: "", serverUrl: "", username: "", password: "", subdomain: "", fullDomain: "", token: "" };

export default function AutomaticHttpsSection({ onReAuthRequired, reauthVersion, onTemporaryBootstrap }: { onReAuthRequired: (key: string[]) => void; reauthVersion: number; onTemporaryBootstrap?: (active: boolean) => void }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["automatic-https"], queryFn: fetchAutomaticHttpsSettings, retry: false,
    refetchInterval: (result) => result.state.data?.activationPending ? 5000 : false });
  const [draft, setDraft] = useState<AutomaticHttpsInput | null>(null);
  const [dnsValid, setDnsValid] = useState(false);
  const [bootstrapCode, setBootstrapCode] = useState("");
  const data = query.data;
  const input = draft || { ...defaults, ...data, username: "", password: "", token: "" };
  const safeBrowser = Boolean(data?.managementTransportReady) && (window.location.protocol === "https:" || (["localhost", "127.0.0.1"].includes(window.location.hostname) && window.location.port === "3001"));
  const credentialTransport = safeBrowser && window.location.protocol === "https:";
  const reauth = useCallback((error: unknown) => {
    if (error instanceof ApiError && (error.status === 401 || (error.status === 403 && /reauth|re-auth|authentication/i.test(error.message)))) onReAuthRequired(["automatic-https"]);
  }, [onReAuthRequired]);
  const save = useMutation({ mutationFn: () => saveAutomaticHttpsSettings(input),
    onSuccess: (saved) => { setDraft(null); setDnsValid(false); client.setQueryData(["automatic-https"], saved); }, onError: reauth });
  const dns = useMutation({ mutationFn: () => input.provider === "cloudflare" ? testAutomaticHttpsConnection() : checkAutomaticHttpsDns(), onSuccess: (result) => setDnsValid(result.valid), onError: reauth });
  const activate = useMutation({ mutationFn: activateAutomaticHttps, onSuccess: async () => { await client.invalidateQueries({ queryKey: ["automatic-https"] }); }, onError: reauth });
  const authorize = useMutation({ mutationFn: () => authorizeAutomaticHttpsBootstrap(bootstrapCode), onSuccess: async () => { setBootstrapCode(""); await client.invalidateQueries({ queryKey: ["automatic-https"] }); }, onError: reauth });
  useEffect(() => { if (query.error) reauth(query.error); }, [query.error, reauth]);
  useEffect(() => { void client.invalidateQueries({ queryKey: ["automatic-https"] }); }, [reauthVersion, client]);
  useEffect(() => { onTemporaryBootstrap?.(Boolean(data?.temporaryBootstrap)); }, [data?.temporaryBootstrap, onTemporaryBootstrap]);
  const busy = save.isPending || dns.isPending || activate.isPending || authorize.isPending || data?.activationPending;
  const error = save.error || dns.error || activate.error || authorize.error || query.error;
  function field(key: keyof AutomaticHttpsInput, value: string | boolean) { setDraft({ ...input, [key]: value }); setDnsValid(false); }

  return <section aria-labelledby="automatic-https-title" className="space-y-4 border-t border-border pt-5">
    <h3 id="automatic-https-title" className="text-base font-semibold text-foreground">Automatic HTTPS</h3>
    <p className="text-sm text-muted-foreground">Certificates renew automatically while provider access and public DNS remain valid.</p>
    {!credentialTransport ? <div role="status" className="space-y-2 text-sm text-muted-foreground">
      {data?.bootstrapUrl && !data.temporaryBootstrap ? <p><a className="underline" href={data.bootstrapUrl}>Open temporary HTTPS setup</a></p> : null}
      <p>Enter credentials using trusted HTTPS or the verified temporary HTTPS setup.</p>
      <p>On the trusted server console, run <code>bash scripts/https-bootstrap.sh</code>. Compare its SHA-256 certificate fingerprint with the browser certificate before accepting a temporary browser exception.</p>
      {!data?.bootstrapUrl && !data?.temporaryBootstrap ? <p>Temporary HTTPS needs an unambiguous private server address. Local recovery remains available at http://localhost:3001.</p> : null}
    </div> : null}
    {data?.temporaryBootstrap && !data.managementTransportReady ? <div className="space-y-2">
      <label htmlFor="https-bootstrap-code" className="block text-sm font-medium">Single-use bootstrap authorization code</label>
      <Input id="https-bootstrap-code" type="password" autoComplete="off" value={bootstrapCode} onChange={(event) => setBootstrapCode(event.target.value)} disabled={busy} />
      <Button type="button" disabled={busy || !bootstrapCode} onClick={() => authorize.mutate()}>Authorize temporary setup</Button>
    </div> : null}
    {data && !data.provisioned ? <p role="status" className="text-sm text-muted-foreground">Run the supported Docker setup/update to provision HTTPS.</p> : null}
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={input.enabled} disabled={busy} onChange={(event) => field("enabled", event.target.checked)} />Enable Automatic HTTPS</label>
    {data?.activeHostname && !input.enabled ? <p className="text-sm text-destructive">Saving will stop HTTPS on port 443. Coordinate any external connection using that port before disabling HTTPS.</p> : null}
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={input.redirectHttpToHttps} disabled={busy || !safeBrowser} onChange={(event) => field("redirectHttpToHttps", event.target.checked)} />Redirect HTTP to HTTPS</label>
    <p className="text-sm text-muted-foreground">Disabled by default. HTTP on port 3000 and HTTPS on port 443 can be tested in parallel. Enable redirects only after HTTPS and the external tunnel origin have been verified.</p>
    {input.redirectHttpToHttps ? <p className="text-sm text-destructive">Redirects can interrupt a tunnel whose origin still uses HTTP. Verify its origin before saving this option.</p> : null}
    <div>
      <label htmlFor="https-provider" className="block text-sm font-medium">Certificate Provider</label>
      <select id="https-provider" className="mt-1 rounded-md border border-input bg-background px-3 py-2 text-sm" value={input.provider} disabled={busy || !safeBrowser} onChange={(event) => {
        const provider = event.target.value as AutomaticHttpsInput["provider"];
        const saved = data?.providerConfigurations?.acmedns;
        setDraft({ ...input, provider, serverUrl: saved?.serverUrl || "", subdomain: saved?.subdomain || "", fullDomain: saved?.fullDomain || "", username: "", password: "", token: "" });
        setDnsValid(false);
      }}><option value="cloudflare">Cloudflare DNS</option><option value="acmedns">ACME-DNS</option></select>
    </div>
    {input.provider === "acmedns" ? <p className="text-sm text-muted-foreground">Use an account from a trusted managed ACME-DNS provider and add the one-time public CNAME below.</p> : <p className="text-sm text-muted-foreground">Use a scoped Cloudflare token with Zone Read and DNS Edit permissions. No CNAME is required. Test Connection checks zone read access; issuance verifies DNS editing.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      {(input.provider === "cloudflare" ? [["hostname", "Hostname", "text"], ["token", "Cloudflare DNS API Token", "password"]] as const : [
        ["hostname", "Hostname", "text"], ["serverUrl", "ACME-DNS server URL", "url"],
        ["username", "ACME-DNS username", "text"], ["password", "ACME-DNS password", "password"],
        ["subdomain", "ACME-DNS subdomain", "text"], ["fullDomain", "ACME-DNS full domain", "text"],
      ] as const).map(([key, label, type]) => <div key={key}>
        <label htmlFor={`https-${key}`} className="block text-sm font-medium">{label}</label>
        <Input id={`https-${key}`} type={type} dir="ltr" value={input[key]} disabled={busy || !safeBrowser || ((key === "username" || key === "password" || key === "token") && !credentialTransport)}
          autoComplete={key === "password" || key === "token" ? "new-password" : "off"} onChange={(event) => field(key, event.target.value)}
          placeholder={(key === "username" || key === "password" || key === "token") && (data?.provider === input.provider ? data.credentialsConfigured : data?.providerConfigurations?.[input.provider]?.credentialsConfigured) ? "Saved; leave blank to retain" : undefined} />
      </div>)}
    </div>
    <Button type="button" disabled={busy || !safeBrowser || !data?.provisioned || !data?.encryptionReady} onClick={() => save.mutate()}>Save Configuration</Button>
    {save.isSuccess && !draft ? <p role="status" className="text-sm text-muted-foreground">Configuration saved. Credentials are never displayed.</p> : null}
    {input.provider === "acmedns" && data?.cname ? <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm">
      <p className="font-semibold">Required public DNS record</p>
      <dl className="mt-2 space-y-1" dir="ltr"><div><dt className="inline font-medium">Type: </dt><dd className="inline">CNAME</dd></div>
        <div><dt className="inline font-medium">Name: </dt><dd className="inline break-all font-mono text-xs">{data.cname.name}</dd></div>
        <div><dt className="inline font-medium">Target: </dt><dd className="inline break-all font-mono text-xs">{data.cname.target}</dd></div></dl>
    </div> : null}
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="secondary" disabled={busy || !safeBrowser || (input.provider === "acmedns" ? !data?.cname : !data?.credentialsConfigured) || Boolean(draft)} onClick={() => dns.mutate()}>{input.provider === "cloudflare" ? "Test Connection" : "Check DNS"}</Button>
      <Button type="button" disabled={busy || !safeBrowser || !dnsValid || !input.enabled || Boolean(draft)} onClick={() => activate.mutate()}>Activate HTTPS</Button>
      <Button type="button" variant="ghost" disabled={query.isFetching} onClick={() => { void query.refetch(); }}>Refresh status</Button>
    </div>
    {dnsValid ? <p role="status" className="text-sm text-muted-foreground">{input.provider === "cloudflare" ? "The token can read the Cloudflare zone for this hostname." : "The public CNAME matches this account."}</p> : null}
    <p className="text-sm text-muted-foreground">Hospital DNS must resolve this hostname to the LAN server. Activation verifies the certificate and RISpro directly through Caddy. The public RISpro URL and external tunnel configuration stay unchanged.</p>
    <dl className="space-y-1 text-sm" aria-live="polite">
      <div><dt className="inline font-medium">HTTPS: </dt><dd className="inline">{data?.status || "Pending"}{data?.activationPending ? " — requesting and verifying certificate" : ""}</dd></div>
      {data?.activeProvider ? <div><dt className="inline font-medium">Active certificate provider: </dt><dd className="inline">{data.activeProvider === "cloudflare" ? "Cloudflare DNS" : "ACME-DNS"}</dd></div> : null}
      <div><dt className="inline font-medium">HTTP redirects: </dt><dd className="inline">{data?.httpRedirectActive ? "Enabled" : "Disabled"}</dd></div>
      <div><dt className="inline font-medium">Certificate issuer: </dt><dd className="inline">{data?.issuer || "Pending"}</dd></div>
      <div><dt className="inline font-medium">Certificate expiration date: </dt><dd className="inline">{data?.expiresAt ? new Date(data.expiresAt).toLocaleDateString() : "Pending"}</dd></div>
      <div><dt className="inline font-medium">Automatic renewal: </dt><dd className="inline">{data?.renewal || "Pending activation"}</dd></div>
      <div><dt className="inline font-medium">Last error: </dt><dd className="inline">{data?.lastError || "None"}</dd></div>
    </dl>
    {data?.activeHostname ? <p className="text-sm"><a className="underline" href={`https://${data.activeHostname}/settings`}>Open HTTPS settings</a></p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error instanceof Error ? error.message : "HTTPS operation failed."}</p> : null}
  </section>;
}
