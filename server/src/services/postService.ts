import prisma from '../config/database';
import { AppError } from '../middleware/errorHandler';
import { paginationHelper, buildPaginationResponse } from '../utils/helpers';
import { PostType, Prisma } from '@prisma/client';

interface CreatePostInput {
  type?: PostType;
  content: string;
  mediaUrls?: string[];
  linkUrl?: string;
}

interface UpdatePostInput {
  content?: string;
  mediaUrls?: string[];
  linkUrl?: string | null;
  isPinned?: boolean;
}

export class PostService {
  async getFeed(userId?: string, page: number = 1, limit: number = 20) {
    const { skip, take } = paginationHelper(page, limit);

    const where: Prisma.PostWhereInput = {
      isPublished: true,
    };

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              fullName: true,
              profilePhotoUrl: true,
              currentDesignation: true,
              membershipTier: {
                select: { name: true, badgeColor: true },
              },
            },
          },
          _count: {
            select: { likes: true, comments: true },
          },
        },
        orderBy: [
          { isPinned: 'desc' },
          { createdAt: 'desc' },
        ],
        skip,
        take,
      }),
      prisma.post.count({ where }),
    ]);

    // Check if current user liked each post
    let likedPostIds: string[] = [];
    if (userId) {
      const likes = await prisma.postLike.findMany({
        where: {
          userId,
          postId: { in: posts.map(p => p.id) },
        },
        select: { postId: true },
      });
      likedPostIds = likes.map(l => l.postId);
    }

    const postsWithLikeStatus = posts.map(post => ({
      ...post,
      likeCount: post._count.likes,
      commentCount: post._count.comments,
      isLiked: likedPostIds.includes(post.id),
    }));

    return buildPaginationResponse(postsWithLikeStatus, total, page, limit);
  }

  async getPost(id: string, userId?: string) {
    const post = await prisma.post.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
            membershipTier: {
              select: { name: true, badgeColor: true },
            },
          },
        },
        comments: {
          where: { parentId: null },
          include: {
            user: {
              select: {
                id: true,
                fullName: true,
                profilePhotoUrl: true,
              },
            },
            replies: {
              include: {
                user: {
                  select: {
                    id: true,
                    fullName: true,
                    profilePhotoUrl: true,
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { likes: true, comments: true },
        },
      },
    });

    if (!post) {
      throw new AppError('Post not found', 404, 'NOT_FOUND');
    }

    let isLiked = false;
    if (userId) {
      const like = await prisma.postLike.findUnique({
        where: { postId_userId: { postId: id, userId } },
      });
      isLiked = !!like;
    }

    return {
      ...post,
      likeCount: post._count.likes,
      commentCount: post._count.comments,
      isLiked,
    };
  }

  async createPost(userId: string, data: CreatePostInput) {
    const post = await prisma.post.create({
      data: {
        userId,
        type: data.type || 'GENERAL',
        content: data.content,
        mediaUrls: data.mediaUrls || [],
        linkUrl: data.linkUrl,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
          },
        },
      },
    });

    return post;
  }

  async updatePost(userId: string, postId: string, data: UpdatePostInput, isAdmin: boolean = false) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new AppError('Post not found', 404, 'NOT_FOUND');
    }

    if (post.userId !== userId && !isAdmin) {
      throw new AppError('Not authorized to update this post', 403, 'FORBIDDEN');
    }

    // Only admin can pin posts
    if (data.isPinned !== undefined && !isAdmin) {
      delete data.isPinned;
    }

    return prisma.post.update({
      where: { id: postId },
      data,
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
            currentDesignation: true,
          },
        },
      },
    });
  }

  async deletePost(userId: string, postId: string, isAdmin: boolean = false) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new AppError('Post not found', 404, 'NOT_FOUND');
    }

    if (post.userId !== userId && !isAdmin) {
      throw new AppError('Not authorized to delete this post', 403, 'FORBIDDEN');
    }

    await prisma.post.delete({ where: { id: postId } });
    return { message: 'Post deleted successfully' };
  }

  async likePost(userId: string, postId: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new AppError('Post not found', 404, 'NOT_FOUND');
    }

    const existingLike = await prisma.postLike.findUnique({
      where: { postId_userId: { postId, userId } },
    });

    if (existingLike) {
      // Unlike
      await prisma.postLike.delete({
        where: { id: existingLike.id },
      });

      await prisma.post.update({
        where: { id: postId },
        data: { likeCount: { decrement: 1 } },
      });

      return { liked: false, likeCount: post.likeCount - 1 };
    }

    // Like
    await prisma.postLike.create({
      data: { postId, userId },
    });

    await prisma.post.update({
      where: { id: postId },
      data: { likeCount: { increment: 1 } },
    });

    // Create notification for post owner
    if (post.userId !== userId) {
      const liker = await prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true },
      });

      await prisma.notification.create({
        data: {
          userId: post.userId,
          type: 'POST_LIKED',
          title: 'New Like',
          message: `${liker?.fullName} liked your post`,
          link: `/posts/${postId}`,
        },
      });
    }

    return { liked: true, likeCount: post.likeCount + 1 };
  }

  async addComment(userId: string, postId: string, content: string, parentId?: string) {
    const post = await prisma.post.findUnique({
      where: { id: postId },
    });

    if (!post) {
      throw new AppError('Post not found', 404, 'NOT_FOUND');
    }

    if (parentId) {
      const parentComment = await prisma.postComment.findUnique({
        where: { id: parentId },
      });

      if (!parentComment || parentComment.postId !== postId) {
        throw new AppError('Parent comment not found', 404, 'NOT_FOUND');
      }
    }

    const comment = await prisma.postComment.create({
      data: {
        postId,
        userId,
        content,
        parentId,
      },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            profilePhotoUrl: true,
          },
        },
      },
    });

    await prisma.post.update({
      where: { id: postId },
      data: { commentCount: { increment: 1 } },
    });

    // Create notification for post owner
    if (post.userId !== userId) {
      const commenter = await prisma.user.findUnique({
        where: { id: userId },
        select: { fullName: true },
      });

      await prisma.notification.create({
        data: {
          userId: post.userId,
          type: 'POST_COMMENTED',
          title: 'New Comment',
          message: `${commenter?.fullName} commented on your post`,
          link: `/posts/${postId}`,
        },
      });
    }

    return comment;
  }

  async deleteComment(userId: string, commentId: string, isAdmin: boolean = false) {
    const comment = await prisma.postComment.findUnique({
      where: { id: commentId },
      include: { post: true },
    });

    if (!comment) {
      throw new AppError('Comment not found', 404, 'NOT_FOUND');
    }

    if (comment.userId !== userId && comment.post.userId !== userId && !isAdmin) {
      throw new AppError('Not authorized to delete this comment', 403, 'FORBIDDEN');
    }

    // Count replies to decrement properly
    const replyCount = await prisma.postComment.count({
      where: { parentId: commentId },
    });

    await prisma.postComment.delete({ where: { id: commentId } });

    await prisma.post.update({
      where: { id: comment.postId },
      data: { commentCount: { decrement: 1 + replyCount } },
    });

    return { message: 'Comment deleted successfully' };
  }
}

export const postService = new PostService();
