import express from 'express';
import prisma from '../lib/prisma.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = express.Router();

// Get all blogs
router.get('/', async (req, res) => {
    try {
        const blogs = await prisma.blog.findMany({
            orderBy: { createdAt: 'desc' },
        });
        res.json(blogs);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch blogs" });
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
router.post('/', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { title, slug, category, author, excerpt, content, image, readTime, featured } = req.body;
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
                authorId: req.auth.userId!, // Assured by requireAuth
            },
        });
        res.status(201).json(blog);
    } catch (error) {
        console.error("Error creating blog:", error);
        res.status(500).json({ error: "Failed to create blog" });
    }
});

// Update blog (Admin only)
router.put('/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { title, slug, category, author, excerpt, content, image, readTime, featured } = req.body;
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
                featured
            },
        });
        res.json(blog);
    } catch (error) {
        console.error("Error updating blog:", error);
        res.status(500).json({ error: "Failed to update blog" });
    }
});

// Delete blog (Admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
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
