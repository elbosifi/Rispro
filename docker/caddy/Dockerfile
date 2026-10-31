FROM caddy:2.11.7-builder-alpine AS builder
RUN xcaddy build v2.11.7 \
    --with github.com/caddy-dns/acmedns@e31051404eb97b5b8c83f68d4d333efc8b31b698 \
    --with github.com/caddy-dns/cloudflare@a8737d095ad5a48ca031cea6ab704057dbc2d250

FROM caddy:2.11.7-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY docker/caddy/Caddyfile /etc/caddy/Caddyfile
COPY docker/caddy/entrypoint.sh /usr/local/bin/rispro-caddy
RUN sed -i 's/\r$//' /usr/local/bin/rispro-caddy && chmod 755 /usr/local/bin/rispro-caddy
ENTRYPOINT ["/usr/local/bin/rispro-caddy"]
