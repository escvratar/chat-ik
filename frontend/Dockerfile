FROM node:20-alpine AS builder
WORKDIR /app
ARG VITE_VAPID_PUBLIC_KEY
ENV VITE_VAPID_PUBLIC_KEY=${VITE_VAPID_PUBLIC_KEY}
ARG VITE_TURN_USERNAME
ENV VITE_TURN_USERNAME=${VITE_TURN_USERNAME}
ARG VITE_TURN_PASSWORD
ENV VITE_TURN_PASSWORD=${VITE_TURN_PASSWORD}
COPY package.json .
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
