import { ApiError } from '../../../../utils/ApiError.js';
import { User } from '../../user/models/User.js';
import { verifyAccessToken } from '../../services/tokenService.js';

export const getIdentityFromSocket = (socket) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    throw new ApiError(401, 'Socket token is required');
  }

  return verifyAccessToken(token);
};

export const attachSocketAuth = (io) => {
  io.use(async (socket, next) => {
    try {
      socket.auth = getIdentityFromSocket(socket);

      if (String(socket.auth.role || '').toLowerCase() === 'user') {
        const user = await User.findById(socket.auth.sub || socket.auth.id || socket.auth._id || socket.auth.userId).select('active isActive deletedAt').lean();

        if (!user || user.deletedAt || user.isActive === false || user.active === false) {
          throw new ApiError(401, 'User account is not active');
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  });
};
