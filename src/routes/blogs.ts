import express from 'express';
import prisma from '../lib/prisma.js';
import { requireAuthOrApiKey, requireAdminOrApiKey } from '../middleware/auth.js';

const router = express.Router();

// Get all blogs (Public)
router.get('/', async (req, res) => {
    try {
        const blogs = await prisma.blog.findMany({
            where: {
                OR: [
                    { publishAt: null },
                    { publishAt: { lte: new Date() } }
                ]
            },
            orderBy: { createdAt: 'desc' },
        });
        res.json(blogs);
    } catch (error) {
        console.log("Error fetching blogs:", error);
        res.status(500).json({ error: "Failed to fetch blogs" });
    }
});

// Get all blogs for admin (Admin only)
router.get('/admin-list', requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
    try {
        const blogs = await prisma.blog.findMany({
            orderBy: { createdAt: 'desc' },
        });
        res.json(blogs);
    } catch (error) {
        console.log("Error fetching blogs for admin:", error);
        res.status(500).json({ error: "Failed to fetch blogs for admin" });
    }
});

// Get single blog
router.get('/:id', async (req, res) => {
    try {
        const blog = await prisma.blog.findUnique({
            where: { id: req.params.id },
        });
        if (!blog) {
            return res.status(404).json({ error: "Blog not found" });
        }
        res.json(blog);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch blog" });
    }
});

// Create blog (Admin only)
router.post('/', requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
    try {
        const { title, slug, category, author, excerpt, content, image, readTime, featured, publishAt } = req.body;
        
        let publishAtDate: Date | null = null;
        if (publishAt) {
            const timestamp = String(publishAt).length === 10 ? Number(publishAt) * 1000 : Number(publishAt);
            publishAtDate = new Date(timestamp);
        }

        const blog = await prisma.blog.create({
            data: {
                title,
                slug,
                category,
                author,
                excerpt,
                content,
                image,
                readTime,
                featured,
                authorId: req.auth?.userId || null,
                publishAt: publishAtDate,
            },
        });
        res.status(201).json(blog);
    } catch (error) {
        console.error("Error creating blog:", error);
        res.status(500).json({ error: "Failed to create blog" });
    }
});

// Update blog (Admin only)
router.put('/:id', requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
    try {
        const { title, slug, category, author, excerpt, content, image, readTime, featured, publishAt } = req.body;
        
        let publishAtDate: Date | null = null;
        if (publishAt !== undefined) {
            if (publishAt) {
                const timestamp = String(publishAt).length === 10 ? Number(publishAt) * 1000 : Number(publishAt);
                publishAtDate = new Date(timestamp);
            }
        }

        const blog = await prisma.blog.update({
            where: { id: req.params.id },
            data: {
                title,
                slug,
                category,
                author,
                excerpt,
                content,
                image,
                readTime,
                featured,
                ...(publishAt !== undefined && { publishAt: publishAtDate })
            },
        });
        res.json(blog);
    } catch (error) {
        console.error("Error updating blog:", error);
        res.status(500).json({ error: "Failed to update blog" });
    }
});

// Delete blog (Admin only)
router.delete('/:id', requireAuthOrApiKey, requireAdminOrApiKey, async (req, res) => {
    try {
        await prisma.blog.delete({
            where: { id: req.params.id },
        });
        res.json({ message: "Blog deleted" });
    } catch (error) {
        res.status(500).json({ error: "Failed to delete blog" });
    }
});

export default router;
