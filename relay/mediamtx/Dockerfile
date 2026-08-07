FROM golang:1.26.0-alpine3.23 AS build

ARG MEDIAMTX_COMMIT=5ccc80ad7b1609330a4c397c51a7e701f963d74f
RUN apk add --no-cache git patch
WORKDIR /src
RUN git init \
    && git remote add origin https://github.com/bluenviron/mediamtx.git \
    && git fetch --depth=1 origin "${MEDIAMTX_COMMIT}" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${MEDIAMTX_COMMIT}"
COPY redirect-guard.patch /tmp/redirect-guard.patch
RUN patch --batch --forward -p1 < /tmp/redirect-guard.patch \
    && go generate ./... \
    && CGO_ENABLED=0 go build -trimpath -ldflags='-s -w' -o /out/mediamtx .

FROM alpine:3.23.3
RUN apk add --no-cache ca-certificates tzdata
COPY --from=build /out/mediamtx /mediamtx
ENTRYPOINT ["/mediamtx"]
